import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { duplicateJsonKeys, validatePhaseLoopPreflight } from './phase-loop-preflight.mjs';
import { buildContractRebaselineReceipt, writeContractRebaselineReceipt } from './phase-loop-todo-contract-rebaseline.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-phase-loop-preflight-'));
  fs.mkdirSync(path.join(repo, 'docs/architecture'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.brownie'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), '- [ ] E-1: Patch only `README.md`:\n  Route: documentation.\n  Verification: run `pnpm --workspace-root guard:release-contract`.\n');
  fs.writeFileSync(path.join(repo, 'docs/architecture/phase-value-manifest.json'), '{ "phase": "E-1" }\n');
  fs.writeFileSync(path.join(repo, 'docs/architecture/runtime-release-readiness-audit.json'), '{ "audited_main_commit": "1111111111111111111111111111111111111111", "runtime_release_ready": false }\n');
  const auditText = fs.readFileSync(path.join(repo, 'docs/architecture/runtime-release-readiness-audit.json'), 'utf8');
  const auditHash = `sha256:${createHash('sha256').update(auditText).digest('hex')}`;
  fs.writeFileSync(path.join(repo, 'docs/architecture/runtime-release-contract.json'), JSON.stringify({
    phase: 'RRP-8.7',
    commit_trace: {
      readiness_audit_content_sha256: auditHash
    }
  }, null, 2) + '\n');
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo });
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });
  return repo;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function activeClaimPlaceholderFixture(repo, options = {}) {
  const stateRoot = path.join(repo, '.brownie/private/phase-loop');
  const claimPath = path.join(stateRoot, 'todo-claims/current.json');
  const queuePath = path.join(stateRoot, 'todo-claims/todo-queue-state.json');
  const runStamp = '20261029T130826Z';
  const claimRunStamp = options.claimRunStamp ?? runStamp;
  const claimId = 'todo-g624-active-r1';
  const queueGeneration = 624;
  const queueFingerprint = 'fixture-active-queue';
  const target = 'scripts/target.mjs';
  const selectedTodo = [
    '- [ ] E-active: Patch only `scripts/active.test.mjs`, then patch only `scripts/target.mjs`:',
    '  Route: implementation.',
    '  Depends on: <none>.',
    '  Completion condition: resume the exact active Runtime claim.',
    '  Verification: run `node --test scripts/active.test.mjs`.'
  ].join('\n');
  const laterTodo = [
    '- [ ] E-later: Patch only `scripts/target.mjs`:',
    '  Route: implementation.',
    '  Depends on: E-active.',
    '  Completion condition: consume the later workflow leaf only after E-active.',
    '  Verification: run `node --test scripts/target.test.mjs`.'
  ].join('\n');
  const selectedHash = createHash('sha256').update(selectedTodo).digest('hex');
  const stdoutPath = path.join(stateRoot, 'runs', `${runStamp}.stdout.log`);
  const evidencePath = path.join(stateRoot, 'runs', `${runStamp}.execution-evidence.json`);

  const completedTodo = [
    '- [x] E-completed: A completed entry that must not alter the active claim block.',
    '  Route: implementation.',
    '  Verification: run `node --test scripts/completed.test.mjs`.'
  ].join('\n');
  const interveningTodo = options.completedTodoAfterSelected === true ? `\n\n${completedTodo}` : '';
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `${selectedTodo}${interveningTodo}\n\n${laterTodo}\n`);
  fs.writeFileSync(path.join(repo, target), '// Brownie bounded Patch-only proposal.\n');
  writeJson(claimPath, {
    schema_version: 1,
    claim_id: claimId,
    status: 'in_progress',
    selected_todo: selectedTodo,
    queue_generation: queueGeneration,
    queue_fingerprint: queueFingerprint,
    run_stamp: claimRunStamp,
    terminal_failure_execution_evidence_path: evidencePath
  });
  writeJson(queuePath, {
    schema_version: 1,
    generation: queueGeneration,
    fingerprint: queueFingerprint
  });
  writeJson(path.join(stateRoot, 'runs', `${runStamp}.runtime-admission.json`), {
    schema_version: 1,
    kind: 'phase_loop_runtime_admission',
    status: 'admitted',
    claim_id: claimId,
    selected_todo_id: 'E-active',
    selected_todo_sha256: selectedHash,
    queue_generation: queueGeneration,
    queue_fingerprint: queueFingerprint
  });
  writeJson(evidencePath, {
    schema_version: 1,
    kind: 'phase_loop_terminal_failure_execution_evidence',
    run_stamp: runStamp,
    claim_id: claimId,
    runtime_claim_id: claimId,
    claim_matches: true,
    selected_todo_id: 'E-active',
    selected_todo_sha256: selectedHash,
    target_files: ['scripts/active.test.mjs', target],
    task_execution_confirmed: true,
    stdout_path: stdoutPath
  });
  writeJson(stdoutPath, {
    run: {
      status: 'objective_proposal_applied',
      phase_loop_claim_id: claimId,
      phase_loop_selected_todo_sha256: selectedHash,
      phase_loop_queue_generation: queueGeneration,
      phase_loop_queue_fingerprint: queueFingerprint,
      objective_apply_applied: true,
      objective_apply_path: target
    }
  });

  return {
    stateRoot,
    claimPath,
    queuePath,
    evidencePath,
    claimId,
    runStamp,
    claimRunStamp,
    target
  };
}

function appendActiveClaimMaterialization(repo, fixture, { runStamp, target }) {
  const claim = JSON.parse(fs.readFileSync(fixture.claimPath, 'utf8'));
  const selectedTodo = claim.selected_todo;
  const selectedHash = createHash('sha256').update(selectedTodo).digest('hex');
  const evidencePath = path.join(fixture.stateRoot, 'runs', `${runStamp}.execution-evidence.json`);
  const stdoutPath = path.join(fixture.stateRoot, 'runs', `${runStamp}.stdout.log`);
  writeJson(path.join(fixture.stateRoot, 'runs', `${runStamp}.runtime-admission.json`), {
    schema_version: 1,
    kind: 'phase_loop_runtime_admission',
    status: 'admitted',
    claim_id: fixture.claimId,
    selected_todo_id: 'E-active',
    selected_todo_sha256: selectedHash,
    queue_generation: 624,
    queue_fingerprint: 'fixture-active-queue'
  });
  writeJson(evidencePath, {
    schema_version: 1,
    kind: 'phase_loop_terminal_failure_execution_evidence',
    run_stamp: runStamp,
    claim_id: fixture.claimId,
    runtime_claim_id: fixture.claimId,
    claim_matches: true,
    selected_todo_id: 'E-active',
    selected_todo_sha256: selectedHash,
    target_files: ['scripts/active.test.mjs', fixture.target],
    task_execution_confirmed: true,
    stdout_path: stdoutPath
  });
  writeJson(stdoutPath, {
    run: {
      status: 'objective_proposal_applied',
      phase_loop_claim_id: fixture.claimId,
      phase_loop_selected_todo_sha256: selectedHash,
      phase_loop_queue_generation: 624,
      phase_loop_queue_fingerprint: 'fixture-active-queue',
      objective_apply_applied: true,
      objective_apply_path: target
    }
  });
  claim.run_stamp = runStamp;
  claim.terminal_failure_execution_evidence_path = evidencePath;
  writeJson(fixture.claimPath, claim);
  return { runStamp, evidencePath, stdoutPath, target };
}

test('detects duplicate JSON keys outside JSON.parse visibility', () => {
  const duplicates = duplicateJsonKeys('{ "a": 1, "nested": { "b": 1, "b": 2 }, "a": 3 }', 'fixture.json');
  assert.equal(duplicates.length, 2);
  assert(duplicates.some((entry) => entry.key === 'a' && entry.object_path === '<root>'));
  assert(duplicates.some((entry) => entry.key === 'b' && entry.object_path === 'nested'));
});

test('rejects release contract readiness audit hash drift', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'docs/architecture/runtime-release-readiness-audit.json'), '{ "audited_main_commit": "1111111111111111111111111111111111111111", "runtime_release_ready": false, "runtime_release_ready": false }\n');
  const result = validatePhaseLoopPreflight({ repo, expectedActor: 'fixture-implementation', skipCommands: true });
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'json_duplicate_key'), JSON.stringify(result.errors));
  assert(result.errors.some((error) => error.code === 'readiness_audit_hash_mismatch'), JSON.stringify(result.errors));
});

test('rejects dirty delivery when only owner blocker remains', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), '- [ ] E-owner: Owner must provide release credentials:\n  Route: owner.\n  Verification: external owner handoff.\n');
  fs.writeFileSync(path.join(repo, 'README.md'), 'dirty\n');
  const result = validatePhaseLoopPreflight({ repo, skipCommands: true });
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'dirty_delivery_required'), JSON.stringify(result.errors));
});

test('rejects a dirty bounded-proposal placeholder before claiming its TODO', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), '- [ ] E-guard: Patch only `scripts/target.mjs`:\n  Route: implementation.\n  Verification: run `node --test scripts/target.test.mjs`.\n');
  fs.writeFileSync(path.join(repo, 'scripts/target.mjs'), '// Brownie bounded Patch-only proposal.\n');
  const result = validatePhaseLoopPreflight({ repo, skipCommands: true });
  const failure = result.errors.find((error) => error.code === 'contract_unsatisfiable_dirty_scope');
  assert(failure, JSON.stringify(result.errors));
  assert.equal(failure.target, 'scripts/target.mjs');
  assert.match(failure.sha256, /^sha256:[a-f0-9]{64}$/u);
});

test('admits an exact active-claim placeholder only for the authenticated resume path', () => {
  const repo = makeRepo();
  const fixture = activeClaimPlaceholderFixture(repo);
  const result = validatePhaseLoopPreflight({
    repo,
    stateRoot: fixture.stateRoot,
    claim: fixture.claimPath,
    stage: 'pre-claim-boundary',
    expectedActor: 'fixture-implementation',
    skipCommands: true
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.warnings.find((warning) => warning.code === 'active_claim_owned_dirty_target_placeholder'), {
    code: 'active_claim_owned_dirty_target_placeholder',
    claim_id: fixture.claimId,
    run_stamp: fixture.runStamp,
    target: fixture.target,
    sha256: `sha256:${createHash('sha256').update('// Brownie bounded Patch-only proposal.').digest('hex')}`,
    message: 'A dirty bounded-proposal placeholder is attributable to the exact active Runtime claim and is admitted only for that claim resume.'
  });
  assert.equal(result.warnings.filter((warning) => warning.code === 'active_claim_owned_dirty_target_placeholder').length, 1);
  const activeClaim = JSON.parse(fs.readFileSync(fixture.claimPath, 'utf8'));
  assert.deepEqual(result.active_claim_resume_admission, {
    schema_version: 1,
    kind: 'phase_loop_active_claim_resume_admission',
    claim_id: fixture.claimId,
    claim_run_stamp: fixture.claimRunStamp,
    selected_todo_id: 'E-active',
    selected_todo_sha256: createHash('sha256').update(activeClaim.selected_todo).digest('hex'),
    queue_generation: 624,
    queue_fingerprint: 'fixture-active-queue',
    admitted_targets: [{
      target: fixture.target,
      sha256: `sha256:${createHash('sha256').update('// Brownie bounded Patch-only proposal.').digest('hex')}`,
      materialization_run_stamp: fixture.runStamp
    }],
    materializations: [{
      materialization_run_stamp: fixture.runStamp,
      materialized_target: fixture.target
    }]
  });
});

test('admits an exact active-claim placeholder during same-claim pre-completion verification', () => {
  const repo = makeRepo();
  const fixture = activeClaimPlaceholderFixture(repo);
  const result = validatePhaseLoopPreflight({
    repo,
    stateRoot: fixture.stateRoot,
    claim: fixture.claimPath,
    stage: 'pre-completion',
    expectedActor: 'fixture-implementation',
    skipCommands: true
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.warnings.filter((warning) => warning.code === 'active_claim_owned_dirty_target_placeholder').length, 1);
  assert.equal(result.active_claim_resume_admission, undefined);
});

test('admits an active claim whose selected TODO is followed by a completed TODO entry', () => {
  const repo = makeRepo();
  const fixture = activeClaimPlaceholderFixture(repo, { completedTodoAfterSelected: true });
  const result = validatePhaseLoopPreflight({
    repo,
    stateRoot: fixture.stateRoot,
    claim: fixture.claimPath,
    stage: 'pre-claim-boundary',
    expectedActor: 'fixture-implementation',
    skipCommands: true
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.warnings.filter((warning) => warning.code === 'active_claim_owned_dirty_target_placeholder').length, 1);
});

test('uses immutable materialization evidence after a claim continuation and defers only a shared future target', () => {
  const repo = makeRepo();
  const fixture = activeClaimPlaceholderFixture(repo);
  const later = appendActiveClaimMaterialization(repo, fixture, {
    runStamp: '20261029T152111Z',
    target: 'scripts/active.test.mjs'
  });
  const result = validatePhaseLoopPreflight({
    repo,
    stateRoot: fixture.stateRoot,
    claim: fixture.claimPath,
    stage: 'pre-claim-boundary',
    expectedActor: 'fixture-implementation',
    skipCommands: true
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.warnings.find((warning) => warning.code === 'active_claim_owned_dirty_target_placeholder')?.run_stamp, fixture.runStamp);
  const deferred = result.warnings.find((warning) => warning.code === 'active_claim_shared_dirty_target_deferred');
  assert(deferred, JSON.stringify(result.warnings));
  assert.equal(deferred.claim_id, fixture.claimId);
  assert.equal(deferred.materialization_run_stamp, fixture.runStamp);
  assert.equal(deferred.selected_todo_id, 'E-active');
  assert.equal(deferred.todo_id, 'E-later');
  assert.equal(deferred.target, fixture.target);
  assert.equal(later.runStamp, '20261029T152111Z');

  const unrelatedTodo = [
    '- [ ] E-unrelated: Patch only `scripts/unrelated.mjs`:',
    '  Route: implementation.',
    '  Depends on: E-active.',
    '  Completion condition: do not inherit the active claim.',
    '  Verification: run `node --test scripts/unrelated.test.mjs`.'
  ].join('\n');
  fs.appendFileSync(path.join(repo, '.brownie/todo.md'), `\n${unrelatedTodo}\n`);
  fs.writeFileSync(path.join(repo, 'scripts/unrelated.mjs'), '// Brownie bounded Patch-only proposal.\n');
  const unrelated = validatePhaseLoopPreflight({
    repo,
    stateRoot: fixture.stateRoot,
    claim: fixture.claimPath,
    stage: 'pre-claim-boundary',
    expectedActor: 'fixture-implementation',
    skipCommands: true
  });
  assert(unrelated.errors.some((error) => error.code === 'contract_unsatisfiable_dirty_scope' && error.target === 'scripts/unrelated.mjs'), JSON.stringify(unrelated.errors));

  const claim = JSON.parse(fs.readFileSync(fixture.claimPath, 'utf8'));
  claim.status = 'completed';
  writeJson(fixture.claimPath, claim);
  const settled = validatePhaseLoopPreflight({
    repo,
    stateRoot: fixture.stateRoot,
    claim: fixture.claimPath,
    stage: 'pre-claim-boundary',
    expectedActor: 'fixture-implementation',
    skipCommands: true
  });
  assert(settled.errors.some((error) => error.code === 'contract_unsatisfiable_dirty_scope' && error.target === fixture.target), JSON.stringify(settled.errors));
});

test('keeps active-claim placeholder admission fail-closed for generic stage, missing target attestation, queue drift, and a non-pending selected TODO', () => {
  const repo = makeRepo();
  const fixture = activeClaimPlaceholderFixture(repo);
  const generic = validatePhaseLoopPreflight({
    repo,
    stateRoot: fixture.stateRoot,
    claim: fixture.claimPath,
    expectedActor: 'fixture-implementation',
    skipCommands: true
  });
  assert(generic.errors.some((error) => error.code === 'contract_unsatisfiable_dirty_scope'), JSON.stringify(generic.errors));
  assert.equal(generic.active_claim_resume_admission, undefined);

  const preClaim = validatePhaseLoopPreflight({
    repo,
    stateRoot: fixture.stateRoot,
    claim: fixture.claimPath,
    stage: 'pre-claim',
    expectedActor: 'fixture-implementation',
    skipCommands: true
  });
  assert.equal(preClaim.valid, true, JSON.stringify(preClaim.errors));
  assert.equal(preClaim.active_claim_resume_admission, undefined);

  const evidence = JSON.parse(fs.readFileSync(fixture.evidencePath, 'utf8'));
  evidence.target_files = ['scripts/active.test.mjs'];
  writeJson(fixture.evidencePath, evidence);
  const noTargetAttestation = validatePhaseLoopPreflight({
    repo,
    stateRoot: fixture.stateRoot,
    claim: fixture.claimPath,
    stage: 'pre-claim',
    expectedActor: 'fixture-implementation',
    skipCommands: true
  });
  assert(noTargetAttestation.errors.some((error) => error.code === 'contract_unsatisfiable_dirty_scope'), JSON.stringify(noTargetAttestation.errors));

  evidence.target_files.push(fixture.target);
  writeJson(fixture.evidencePath, evidence);
  const queue = JSON.parse(fs.readFileSync(fixture.queuePath, 'utf8'));
  queue.fingerprint = 'shifted-queue';
  writeJson(fixture.queuePath, queue);
  const queueDrift = validatePhaseLoopPreflight({
    repo,
    stateRoot: fixture.stateRoot,
    claim: fixture.claimPath,
    stage: 'pre-claim',
    expectedActor: 'fixture-implementation',
    skipCommands: true
  });
  assert(queueDrift.errors.some((error) => error.code === 'contract_unsatisfiable_dirty_scope'), JSON.stringify(queueDrift.errors));

  queue.fingerprint = 'fixture-active-queue';
  writeJson(fixture.queuePath, queue);
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8')
    .replace('- [ ] E-active:', '- [x] E-active:');
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), todo);
  const completedSelectedTodo = validatePhaseLoopPreflight({
    repo,
    stateRoot: fixture.stateRoot,
    claim: fixture.claimPath,
    stage: 'pre-claim',
    expectedActor: 'fixture-implementation',
    skipCommands: true
  });
  assert(completedSelectedTodo.errors.some((error) => error.code === 'contract_unsatisfiable_dirty_scope'), JSON.stringify(completedSelectedTodo.errors));
});

test('admits an audited Create-to-Patch placeholder only when its exact target hash is captured', () => {
  const repo = makeRepo();
  const before = '- [ ] E-guard: Create only `scripts/target.mjs`:\n  Route: implementation.\n  Verification: run `node --test scripts/target.test.mjs`.\n';
  const after = before.replace('Create only', 'Patch only');
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), before);
  execFileSync('git', ['add', '.brownie/todo.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'create target contract'], { cwd: repo, stdio: 'ignore' });
  const placeholder = '// Brownie bounded Create-only proposal.\n';
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), after);
  fs.writeFileSync(path.join(repo, 'scripts/target.mjs'), placeholder);
  writeContractRebaselineReceipt(repo, buildContractRebaselineReceipt({
    repoRoot: repo,
    beforeTodoText: before,
    afterTodoText: after,
    runStamp: 'fixture-materialized-target',
    eventKey: 'fixture-materialized-target-event',
    diagnostic: 'contract_unsatisfiable_dirty_scope',
    verification: {
      repair_command: 'node scripts/phase-loop-preclaim-recovery.mjs',
      guard_command: 'node scripts/guard-todo-decomposition.mjs',
      integrity_command: 'pnpm -s phase-loop:todo-queue-integrity'
    },
    targetSnapshots: [{
      operation: 'Create',
      path: 'scripts/target.mjs',
      exists_before: false,
      sha256_before: null,
      exists_after: true,
      sha256_after: createHash('sha256').update(placeholder.trim()).digest('hex')
    }]
  }));
  const result = validatePhaseLoopPreflight({ repo, expectedActor: 'fixture-implementation', skipCommands: true });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.warnings.find((warning) => warning.code === 'rebaselined_dirty_target_placeholder'), {
    code: 'rebaselined_dirty_target_placeholder',
    todo_id: 'E-guard',
    target: 'scripts/target.mjs',
    contract_rebaseline_run_stamp: 'fixture-materialized-target',
    message: 'A materialized Create-only target is admitted as Patch-only only through an exact target-hash-bound rebaseline receipt.'
  });
});

test('admits a hash-bound materialization through a contiguous approved rebaseline chain', () => {
  const repo = makeRepo();
  const before = '- [ ] E-chain: Create only `scripts/target.mjs` and `scripts/other.mjs`:\n  Route: implementation.\n  Verification: run `node --test scripts/target.test.mjs`.\n';
  const middle = before.replace('Create only `scripts/target.mjs` and `scripts/other.mjs`', 'Patch only `scripts/target.mjs` and Create only `scripts/other.mjs`');
  const after = middle.replace('Create only `scripts/other.mjs`', 'Patch only `scripts/other.mjs`');
  const placeholder = '// Brownie bounded Create-only proposal.\n';
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), before);
  execFileSync('git', ['add', '.brownie/todo.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'create chain contract'], { cwd: repo, stdio: 'ignore' });
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), after);
  fs.writeFileSync(path.join(repo, 'scripts/target.mjs'), placeholder);
  const verification = { repair_command: 'node scripts/phase-loop-preclaim-recovery.mjs', guard_command: 'node scripts/guard-todo-decomposition.mjs', integrity_command: 'pnpm -s phase-loop:todo-queue-integrity' };
  writeContractRebaselineReceipt(repo, buildContractRebaselineReceipt({ repoRoot: repo, beforeTodoText: before, afterTodoText: middle, runStamp: 'chain-capture', eventKey: 'chain-capture-event', diagnostic: 'contract_unsatisfiable_dirty_scope', verification, targetSnapshots: [{ operation: 'Create', path: 'scripts/target.mjs', exists_before: false, sha256_before: null, exists_after: true, sha256_after: createHash('sha256').update(placeholder.trim()).digest('hex') }] }));
  writeContractRebaselineReceipt(repo, buildContractRebaselineReceipt({ repoRoot: repo, beforeTodoText: middle, afterTodoText: after, runStamp: 'chain-terminal', eventKey: 'chain-terminal-event', diagnostic: 'contract_unsatisfiable_dirty_scope', verification }));
  const result = validatePhaseLoopPreflight({ repo, expectedActor: 'fixture-implementation', skipCommands: true });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.warnings.find((warning) => warning.code === 'rebaselined_dirty_target_placeholder')?.contract_rebaseline_run_stamp, 'chain-terminal');
});

test('rejects an unchecked child whose parent TODO is already complete', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), [
    '- [x] E-parent: Completed parent.',
    '- [ ] E-child: Patch only `scripts/target.mjs`:',
    '  Route: implementation.',
    '  Source TODO: E-parent.',
    '  Verification: run `node --test scripts/target.test.mjs`.'
  ].join('\n') + '\n');
  const result = validatePhaseLoopPreflight({ repo, skipCommands: true });
  const failure = result.errors.find((error) => error.code === 'completed_parent_pending_child');
  assert(failure, JSON.stringify(result.errors));
  assert.equal(failure.parent_todo, 'E-parent');
  assert.equal(failure.child_todo, 'E-child');
});

test('accepts only an audited replan child of a checked superseded parent', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), [
    '- [x] E-parent: Superseded by bounded children.',
    '- [ ] E-child: Patch only `scripts/target.mjs`:',
    '  Route: implementation.',
    '  Source TODO: E-parent.',
    '  Verification: run `node --test scripts/target.test.mjs`.'
  ].join('\n') + '\n');
  writeJson(path.join(repo, '.brownie/private/phase-loop/todo-replans/terminal-replan.json'), {
    schema_version: 1,
    record_type: 'todo_replan',
    operation: 'split_parent_into_children',
    parent_status: 'superseded_by_children',
    parent_todo_id: 'E-parent',
    generated_child_ids: ['E-child']
  });
  const result = validatePhaseLoopPreflight({ repo, expectedActor: 'fixture-implementation', skipCommands: true });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.errors.some((error) => error.code === 'completed_parent_pending_child'), false);
});

test('rejects an unchecked child omitted from a checked parent replan record', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), [
    '- [x] E-parent: Superseded by bounded children.',
    '- [ ] E-child-unbound: Patch only `scripts/target.mjs`:',
    '  Route: implementation.',
    '  Source TODO: E-parent.',
    '  Verification: run `node --test scripts/target.test.mjs`.'
  ].join('\n') + '\n');
  writeJson(path.join(repo, '.brownie/private/phase-loop/todo-replans/terminal-replan.json'), {
    schema_version: 1,
    record_type: 'todo_replan',
    operation: 'split_parent_into_children',
    parent_status: 'superseded_by_children',
    parent_todo_id: 'E-parent',
    generated_child_ids: ['E-other-child']
  });
  const result = validatePhaseLoopPreflight({ repo, skipCommands: true });
  const failure = result.errors.find((error) => error.code === 'completed_parent_pending_child');
  assert(failure, JSON.stringify(result.errors));
  assert.equal(failure.child_todo, 'E-child-unbound');
});

test('accepts Brownie-managed state changes when only an owner blocker remains', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), '- [ ] E-owner: Owner must provide release credentials:\n  Route: owner.\n  Verification: external owner handoff.\n');
  fs.mkdirSync(path.join(repo, '.brownie/release-evidence'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.brownie/release-evidence/managed-state.json'), '{"generated":true}\n');
  const result = validatePhaseLoopPreflight({ repo, skipCommands: true });
  assert(!result.errors.some((error) => error.code === 'dirty_delivery_required'), JSON.stringify(result.errors));
});

test('allows claim-smoke recovery to deliver dirty workspace progress for a pending completed claim', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), '- [ ] E-owner: Owner must provide release credentials:\n  Route: owner.\n  Verification: external owner handoff.\n');
  fs.writeFileSync(path.join(repo, 'README.md'), 'dirty\n');
  const claim = path.join(os.tmpdir(), `brownie-pending-completion-claim-${Date.now()}.json`);
  fs.writeFileSync(claim, JSON.stringify({
    status: 'completed',
    completion_cleanup_pending: true,
    completion_pr_pending: false
  }));
  const previous = process.env.PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY;
  process.env.PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY = '1';
  try {
    const fixtureResult = validatePhaseLoopPreflight({
      repo,
      controlPlaneRoot: repositoryRoot,
      profile: 'claim-smoke-fixture',
      claim,
      skipCommands: true
    });
    assert(!fixtureResult.errors.some((error) => error.code === 'dirty_delivery_required'), JSON.stringify(fixtureResult.errors));

    const productionResult = validatePhaseLoopPreflight({ repo, claim, skipCommands: true });
    assert(productionResult.errors.some((error) => error.code === 'dirty_delivery_required'), JSON.stringify(productionResult.errors));
    assert(productionResult.errors.some((error) => error.code === 'phase_loop_preflight_fixture_marker_forbidden'), JSON.stringify(productionResult.errors));
  } finally {
    if (previous === undefined) delete process.env.PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY;
    else process.env.PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY = previous;
    fs.rmSync(claim, { force: true });
  }
});

test('accepts an absolute TODO path inside the repository', () => {
  const repo = makeRepo();
  const result = validatePhaseLoopPreflight({
    repo,
    todo: path.join(repo, '.brownie/todo.md'),
    expectedActor: 'fixture-implementation',
    skipCommands: true
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test('rejects a TODO path outside the repository', () => {
  const repo = makeRepo();
  const outsideTodo = path.join(os.tmpdir(), `brownie-outside-${Date.now()}.md`);
  fs.writeFileSync(outsideTodo, '- [ ] E-outside: Patch only `README.md`\n');
  const result = validatePhaseLoopPreflight({ repo, todo: outsideTodo, skipCommands: true });
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'required_file_outside_repository'), JSON.stringify(result.errors));
  fs.rmSync(outsideTodo);
});

test('rejects an in-repository TODO symlink that resolves outside the repository', () => {
  const repo = makeRepo();
  const outsideTodo = path.join(os.tmpdir(), `brownie-outside-link-${Date.now()}.md`);
  const linkedTodo = path.join(repo, '.brownie/todo-link.md');
  fs.writeFileSync(outsideTodo, '- [ ] E-outside: Patch only `README.md`\n');
  fs.symlinkSync(outsideTodo, linkedTodo);
  const result = validatePhaseLoopPreflight({ repo, todo: linkedTodo, skipCommands: true });
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'required_file_outside_repository'), JSON.stringify(result.errors));
  fs.rmSync(outsideTodo);
});

test('accepts a workspace TODO snapshot and records source, fingerprint, and queue CAS evidence', () => {
  const repo = makeRepo();
  const sourceTodo = path.join(os.tmpdir(), `brownie-snapshot-source-${Date.now()}.md`);
  const snapshotTodo = path.join(repo, '.brownie', 'todo-snapshot.md');
  const breakdown = path.join(repo, '.brownie', 'todo-breakdown.md');
  const todoText = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');
  fs.writeFileSync(sourceTodo, todoText);
  fs.writeFileSync(snapshotTodo, todoText);
  fs.writeFileSync(breakdown, '# snapshot breakdown\n');
  const result = validatePhaseLoopPreflight({
    repo,
    todo: snapshotTodo,
    breakdown,
    snapshotSource: sourceTodo,
    expectedActor: 'fixture-implementation',
    controllerFingerprint: `sha256:${'a'.repeat(64)}`,
    skipCommands: true
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.snapshot_audit.source_path, sourceTodo);
  assert.equal(result.snapshot_audit.snapshot_path, snapshotTodo);
  assert.equal(result.snapshot_audit.source_sha256, result.snapshot_audit.snapshot_sha256);
  assert.match(result.snapshot_audit.queue_cas, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(result.snapshot_audit.controller_source_fingerprint, `sha256:${'a'.repeat(64)}`);
  fs.rmSync(sourceTodo);
});

test('runs the TODO guard against the configured snapshot path and rejects malformed snapshot content', () => {
  const repo = makeRepo();
  fs.copyFileSync(path.join(repositoryRoot, 'package.json'), path.join(repo, 'package.json'));
  const snapshotTodo = path.join(repo, '.brownie', 'todo-snapshot.md');
  const breakdown = path.join(repo, '.brownie', 'todo-breakdown.md');
  fs.writeFileSync(snapshotTodo, 'const malformedSnapshot = true;\n');
  fs.writeFileSync(breakdown, '# snapshot breakdown\n');
  assert.throws(
    () => execFileSync('node', [
      path.join(repositoryRoot, 'scripts/guard-todo-decomposition.mjs'),
      '--todo', snapshotTodo,
      '--breakdown', breakdown
    ], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    /TODO decomposition guard failed/u
  );
  const preflight = fs.readFileSync(path.join(repositoryRoot, 'scripts/phase-loop-preflight.mjs'), 'utf8');
  assert.match(preflight, /guard-todo-decomposition\.mjs'\), '--repo', policyRoot, '--todo', absoluteTodoPath, '--breakdown', absoluteBreakdownPath/u);
  assert.match(preflight, /phase-loop-todo-queue-integrity\.mjs'\), '--repo', repoRoot, '--todo', absoluteTodoPath, '--breakdown', absoluteBreakdownPath/u);
});

test('snapshot audit rejection preserves claim, ledger, status, and runtime state', () => {
  const repo = makeRepo();
  const sourceTodo = path.join(os.tmpdir(), `brownie-snapshot-protected-${Date.now()}.md`);
  const snapshotTodo = path.join(repo, '.brownie', 'todo-snapshot.md');
  const breakdown = path.join(repo, '.brownie', 'todo-breakdown.md');
  const stateDir = path.join(repo, '.brownie', 'private', 'phase-loop');
  fs.mkdirSync(path.join(stateDir, 'todo-claims'), { recursive: true });
  fs.mkdirSync(path.join(stateDir, 'runs'), { recursive: true });
  const protectedFiles = [
    path.join(stateDir, 'todo-claims', 'current.json'),
    path.join(stateDir, 'status.json'),
    path.join(stateDir, 'task-ledger.jsonl'),
    path.join(stateDir, 'runs', 'runtime.bin')
  ];
  for (const file of protectedFiles) fs.writeFileSync(file, `protected:${path.basename(file)}\n`);
  const sourceText = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');
  fs.writeFileSync(sourceTodo, sourceText);
  fs.writeFileSync(snapshotTodo, `${sourceText}\nmalformed audited mutation\n`);
  fs.writeFileSync(breakdown, '# snapshot breakdown\n');
  const digestFiles = () => protectedFiles.map((file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  const before = digestFiles();
  const result = validatePhaseLoopPreflight({
    repo,
    todo: snapshotTodo,
    breakdown,
    snapshotSource: sourceTodo,
    snapshotAudit: path.join(repo, '.brownie', 'missing-snapshot-audit.json'),
    controllerFingerprint: `sha256:${'b'.repeat(64)}`,
    skipCommands: true
  });
  assert.equal(result.valid, false, JSON.stringify(result.errors));
  assert(result.errors.some((error) => error.code === 'todo_snapshot_mutation_audit_missing'), JSON.stringify(result.errors));
  assert.deepEqual(digestFiles(), before);
  fs.rmSync(sourceTodo);
});

test('runs required preflight commands from the controller root when the workspace has older scripts', () => {
  const repo = makeRepo();
  const workspaceScriptNames = [
    'guard-todo-decomposition.mjs',
    'phase-loop-todo-queue-integrity.mjs',
    'guard-release-contract.mjs',
    'guard-runtime-release-readiness.mjs'
  ];
  for (const name of workspaceScriptNames) {
    fs.writeFileSync(path.join(repo, 'scripts', name), 'process.exit(91);\n');
  }
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'old workspace control scripts'], { cwd: repo, stdio: 'ignore' });
  const controlPlaneRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-controller-root-'));
  fs.mkdirSync(path.join(controlPlaneRoot, 'scripts'), { recursive: true });
  for (const name of workspaceScriptNames) {
    fs.writeFileSync(path.join(controlPlaneRoot, 'scripts', name), '#!/usr/bin/env node\nprocess.exit(0);\n');
  }
  const result = validatePhaseLoopPreflight({ repo, controlPlaneRoot, expectedActor: 'fixture-implementation' });
  assert.equal(result.valid, true, JSON.stringify(result, null, 2));
  assert.deepEqual(result.command_results.map((entry) => entry.exit_code), [0, 0, 0, 0]);
});

test('rejects the claim-smoke fixture profile without its explicit test-only marker', () => {
  const repo = makeRepo();
  const previous = process.env.PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY;
  delete process.env.PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY;
  try {
    const result = validatePhaseLoopPreflight({ repo, profile: 'claim-smoke-fixture', skipCommands: true });
    assert.equal(result.valid, false, JSON.stringify(result, null, 2));
    assert(result.errors.some((error) => error.code === 'phase_loop_preflight_fixture_profile_forbidden'), JSON.stringify(result.errors));
  } finally {
    if (previous === undefined) delete process.env.PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY;
    else process.env.PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY = previous;
  }
});

test('rejects the fixture marker outside the claim-smoke fixture profile', () => {
  const repo = makeRepo();
  const previous = process.env.PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY;
  process.env.PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY = '1';
  try {
    const productionResult = validatePhaseLoopPreflight({ repo, profile: 'production', skipCommands: true });
    assert.equal(productionResult.valid, false, JSON.stringify(productionResult, null, 2));
    assert(productionResult.errors.some((error) => error.code === 'phase_loop_preflight_fixture_marker_forbidden'), JSON.stringify(productionResult.errors));

    const otherResult = validatePhaseLoopPreflight({ repo, profile: 'other', skipCommands: true });
    assert(otherResult.errors.some((error) => error.code === 'phase_loop_preflight_fixture_marker_forbidden'), JSON.stringify(otherResult.errors));
  } finally {
    if (previous === undefined) delete process.env.PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY;
    else process.env.PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY = previous;
  }
});

test('allows an external temporary queue only under the explicit claim-smoke fixture profile', () => {
  const repo = makeRepo();
  const outsideTodo = path.join(os.tmpdir(), `brownie-claim-smoke-todo-${Date.now()}.md`);
  fs.writeFileSync(outsideTodo, '- [ ] B-01: durable claim task\n');
  const previous = process.env.PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY;
  process.env.PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY = '1';
  try {
    const result = validatePhaseLoopPreflight({
      repo,
      controlPlaneRoot: repositoryRoot,
      profile: 'claim-smoke-fixture',
      todo: outsideTodo,
      expectedActor: 'fixture-implementation'
    });
    assert.equal(result.valid, true, JSON.stringify(result, null, 2));
    assert.equal(result.command_results.length, 1);
  } finally {
    if (previous === undefined) delete process.env.PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY;
    else process.env.PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY = previous;
    fs.rmSync(outsideTodo, { force: true });
  }
});

test('keeps production preflight strict when a controller root is supplied', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-phase-loop-minimal-workspace-'));
  fs.mkdirSync(path.join(repo, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), '- [ ] E-1: Patch only `README.md`:\n  Route: documentation.\n  Verification: inspect README.md.\n');
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo });
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });
  const result = validatePhaseLoopPreflight({ repo, controlPlaneRoot: repositoryRoot, skipCommands: true });
  assert.equal(result.valid, false, JSON.stringify(result, null, 2));
  assert(result.errors.some((error) => error.code === 'required_file_unreadable' || error.code === 'readiness_audit_hash_mismatch'), JSON.stringify(result.errors));
});

test('accepts sequential controller-owned completion mutations for multiple TODOs', () => {
  const repo = makeRepo();
  const sourceTodo = path.join(os.tmpdir(), `brownie-snapshot-multi-${Date.now()}.md`);
  const snapshotTodo = path.join(repo, '.brownie', 'todo-snapshot.md');
  const breakdown = path.join(repo, '.brownie', 'todo-breakdown.md');
  const first = '- [ ] E-first: Patch only `README.md`:\n  Route: documentation.\n  Verification: run `pnpm --workspace-root guard:release-contract`.\n';
  const second = '- [ ] E-second: Patch only `CHANGELOG.md`:\n  Route: documentation.\n  Verification: run `pnpm --workspace-root guard:release-contract`.\n';
  const third = '- [ ] E-third: Patch only `LICENSE`:\n  Route: documentation.\n  Verification: run `pnpm --workspace-root guard:release-contract`.\n';
  const sourceText = `${first}${second}${third}`;
  fs.writeFileSync(sourceTodo, sourceText);
  fs.writeFileSync(breakdown, '# snapshot breakdown\n');
  fs.writeFileSync(snapshotTodo, sourceText);
  const digest = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
  const queueCas = (todoText) => digest(`${digest(todoText)}\n${digest(fs.readFileSync(breakdown, 'utf8'))}`);
  const auditPath = path.join(repo, '.brownie', 'todo-snapshot-audit.json');
  const writeAudit = (snapshotText, generation, previousSnapshotText, removedTodo) => {
    fs.writeFileSync(snapshotTodo, snapshotText);
    fs.writeFileSync(auditPath, JSON.stringify({
      schema_version: 1,
      source_path: sourceTodo,
      source_base_sha256: digest(sourceText),
      source_sha256: digest(sourceText),
      snapshot_path: snapshotTodo,
      snapshot_sha256: digest(snapshotText),
      breakdown_path: breakdown,
      breakdown_sha256: digest(fs.readFileSync(breakdown, 'utf8')),
      queue_cas: queueCas(snapshotText),
      generation,
      mutation: {
        kind: 'completed_todo_removal',
        previous_snapshot_sha256: digest(previousSnapshotText),
        removed_todo_first_line: removedTodo
      }
    }, null, 2) + '\n');
  };
  let result = validatePhaseLoopPreflight({
    repo,
    todo: snapshotTodo,
    breakdown,
    snapshotSource: sourceTodo,
    snapshotAudit: auditPath,
    expectedActor: 'fixture-implementation',
    skipCommands: true
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.snapshot_audit.generation, 0);
  writeAudit(`${second}${third}`, 1, sourceText, first.split('\n')[0]);
  result = validatePhaseLoopPreflight({
    repo,
    todo: snapshotTodo,
    breakdown,
    snapshotSource: sourceTodo,
    snapshotAudit: auditPath,
    expectedActor: 'fixture-implementation',
    skipCommands: true
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.snapshot_audit.generation, 1);
  writeAudit(third, 2, `${second}${third}`, second.split('\n')[0]);
  result = validatePhaseLoopPreflight({
    repo,
    todo: snapshotTodo,
    breakdown,
    snapshotSource: sourceTodo,
    snapshotAudit: auditPath,
    expectedActor: 'fixture-implementation',
    skipCommands: true
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.snapshot_audit.generation, 2);
  fs.rmSync(sourceTodo);
});

test('rejects a workspace TODO snapshot whose source fingerprint changed', () => {
  const repo = makeRepo();
  const sourceTodo = path.join(os.tmpdir(), `brownie-snapshot-mismatch-${Date.now()}.md`);
  const snapshotTodo = path.join(repo, '.brownie', 'todo-snapshot.md');
  const breakdown = path.join(repo, '.brownie', 'todo-breakdown.md');
  fs.writeFileSync(sourceTodo, '- [ ] E-source: Patch only `README.md`\n');
  fs.copyFileSync(path.join(repo, '.brownie/todo.md'), snapshotTodo);
  fs.writeFileSync(breakdown, '# snapshot breakdown\n');
  const result = validatePhaseLoopPreflight({
    repo,
    todo: snapshotTodo,
    breakdown,
    snapshotSource: sourceTodo,
    skipCommands: true
  });
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'todo_snapshot_mutation_audit_missing'), JSON.stringify(result.errors));
  fs.rmSync(sourceTodo);
});

test('places the strict preflight boundary before claim rebaseline and forbids ledger/runtime continuation', () => {
  const controller = fs.readFileSync(path.join(repositoryRoot, 'phase-loop.sh'), 'utf8');
  const runOnce = controller.indexOf('_run_brownie_once()');
  const admissionBackedRestore = controller.indexOf('phase_loop_restore_admission_backed_stale_claim "$run_stamp"', runOnce);
  const boundary = controller.indexOf('run_phase_loop_preflight "$run_stamp" "pre-claim-boundary"', runOnce);
  const rebaseline = controller.indexOf('phase_loop_rebaseline_stale_claim "$run_stamp"', runOnce);
  const restoreTransition = controller.indexOf('restore_terminal_failure_source_transition_obligation', boundary);
  assert.ok(admissionBackedRestore >= 0);
  assert.ok(boundary >= 0);
  assert.ok(admissionBackedRestore < boundary);
  assert.ok(boundary < rebaseline);
  assert.ok(boundary < restoreTransition);
  assert.match(controller, /phase_loop_preflight_boundary_failed=true claim_reuse=forbidden ledger_transition=forbidden runtime_start=forbidden/u);
  assert.ok(controller.includes('if [ "$stage" = "pre-claim-boundary" ]; then'));
  assert.ok(controller.indexOf('return 78', boundary) < rebaseline);
  assert.doesNotMatch(controller.slice(admissionBackedRestore, boundary), /run_brownie_runtime|write_bdk_trajectory_event/u);
  assert.doesNotMatch(controller.slice(boundary, restoreTransition), /write_bdk_trajectory_event/u);
  const preflightFunction = controller.indexOf('run_phase_loop_preflight()');
  const preflightCommand = controller.indexOf('node "$ROOT_DIR/scripts/phase-loop-preflight.mjs"', preflightFunction);
  const fixtureProfileRejection = controller.indexOf('phase_loop_preflight_fixture_profile_rejected=true', preflightFunction);
  assert.ok(fixtureProfileRejection >= 0);
  assert.ok(fixtureProfileRejection < preflightCommand);
  const fixtureMarkerRejection = controller.indexOf('phase_loop_preflight_fixture_marker_rejected=true', preflightFunction);
  assert.ok(fixtureMarkerRejection >= 0);
  assert.ok(fixtureMarkerRejection < preflightCommand);
  const auditFailure = controller.indexOf('if ! write_phase_loop_snapshot_audit "$run_stamp" "$output"; then', preflightFunction);
  assert.ok(auditFailure >= 0);
  assert.ok(auditFailure < rebaseline);
  const auditFailureReturn = controller.indexOf('      return 78', auditFailure);
  const auditFailureBoundary = controller.slice(auditFailure, auditFailureReturn);
  assert.match(auditFailureBoundary, /phase_loop_snapshot_audit_failed=true claim_reuse=forbidden ledger_transition=forbidden runtime_start=forbidden/u);
  assert.doesNotMatch(auditFailureBoundary, /phase_loop_rebaseline_stale_claim|write_bdk_trajectory_event|run_brownie_runtime/u);
  const resumeAdmissionWriter = controller.indexOf('write_phase_loop_active_claim_resume_admission()');
  const resumeAdmissionWrite = controller.indexOf('if ! write_phase_loop_active_claim_resume_admission "$run_stamp" "$output"; then', preflightFunction);
  assert.ok(resumeAdmissionWriter >= 0);
  assert.ok(resumeAdmissionWrite > auditFailure);
  assert.ok(resumeAdmissionWrite < boundary);
  assert.match(controller.slice(resumeAdmissionWrite, rebaseline), /active_claim_resume_admission_failed=true claim_reuse=forbidden ledger_transition=forbidden runtime_start=forbidden/u);
  const staleRebaseline = controller.slice(controller.indexOf('phase_loop_rebaseline_stale_claim()'), controller.indexOf('\n}\n\nwrite_runtime_execution_evidence()', controller.indexOf('phase_loop_rebaseline_stale_claim()')));
  assert.match(staleRebaseline, /--resume-admission/u);
});

test('writes a parseable current-run active-claim resume-admission receipt', () => {
  const controller = fs.readFileSync(path.join(repositoryRoot, 'phase-loop.sh'), 'utf8');
  const marker = "output=\"$(printf '%s' \"$preflight_output\" | python3 -c '" + '\n';
  const start = controller.indexOf(marker);
  const end = controller.indexOf("' \"$receipt_path\" \"$run_stamp\" 2>&1)\"", start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const writer = controller.slice(start + marker.length, end);
  const receiptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-resume-admission-'));
  const receiptPath = path.join(receiptDir, 'receipt.json');
  const admission = {
    active_claim_resume_admission: {
      schema_version: 1,
      kind: 'phase_loop_active_claim_resume_admission',
      claim_id: 'claim-fixture',
      selected_todo_id: 'E-fixture',
      selected_todo_sha256: 'a'.repeat(64),
      queue_generation: 1,
      queue_fingerprint: 'fixture-queue',
      admitted_targets: [{ target: 'scripts/fixture.mjs' }],
      materializations: [{ materialized_target: 'scripts/fixture.mjs' }]
    }
  };
  const result = execFileSync('python3', ['-c', writer, receiptPath, '20261029T210410Z'], {
    input: JSON.stringify(admission),
    encoding: 'utf8'
  });
  assert.equal(result.trim(), 'written');
  const receiptText = fs.readFileSync(receiptPath, 'utf8');
  assert.equal(receiptText.endsWith('\n'), true);
  assert.equal(receiptText.endsWith('\\n'), false);
  const receipt = JSON.parse(receiptText);
  assert.equal(receipt.kind, 'phase_loop_active_claim_resume_admission_receipt');
  assert.equal(receipt.run_stamp, '20261029T210410Z');
});

test('quality-gate repair feedback keeps the exact malformed structured target', () => {
  const controller = fs.readFileSync(path.join(repositoryRoot, 'phase-loop.sh'), 'utf8');
  const marker = 'changed_file_quality_gate="$(python3 - "$changed_file_quality_gate" "$active_target_path" "$restored_quality_gate_targets" <<\'PY\'\n';
  const start = controller.indexOf(marker);
  assert.ok(start >= 0);
  const end = controller.indexOf('\nPY\n)"', start);
  assert.ok(end > start);
  const feedbackNormalizer = controller.slice(start + marker.length, end);
  const normalized = JSON.parse(execFileSync('python3', [
    '-c',
    feedbackNormalizer,
    JSON.stringify({
      completed: false,
      reason: 'changed_file_quality_gate_failed',
      changed_files: ['package.json', 'scripts/release-artifact-runtime-journey.test.mjs'],
      results: [{
        command: 'node scripts/guard-json-parse.mjs package.json',
        exit_code: 1,
        stderr_tail: 'package.json: invalid JSON'
      }]
    }),
    'scripts/release-artifact-runtime-journey.test.mjs',
    '1'
  ], { encoding: 'utf8' }));

  assert.equal(normalized.repair_mode, 'structured_target_repair');
  assert.deepEqual(normalized.structured_target_paths, ['package.json']);
  assert.equal(normalized.selected_target_path, 'package.json');
  assert.equal(normalized.selected_target_path_source, 'changed_file_quality_gate');
  assert.equal(normalized.legacy_selected_target_path, 'scripts/release-artifact-runtime-journey.test.mjs');
  assert.deepEqual(normalized.semantic_repair_policy.structured_target_paths, ['package.json']);
  assert(normalized.semantic_repair_policy.forbidden_next_actions.includes('redirect repair to an unrelated first Patch-only target'));
});

test('objective apply rejection becomes exact-target structured repair feedback before progress integrity', () => {
  const controller = fs.readFileSync(path.join(repositoryRoot, 'phase-loop.sh'), 'utf8');
  const helperStart = controller.indexOf('runtime_stdout_objective_apply_rejection_feedback()');
  const marker = '  python3 - "$stdout_log" "$active_target_path" <<\'PY\'\n';
  const start = controller.indexOf(marker, helperStart);
  const end = controller.indexOf('\nPY\n}', start);
  assert.ok(helperStart >= 0);
  assert.ok(start > helperStart);
  assert.ok(end > start);
  const feedbackBuilder = controller.slice(start + marker.length, end);
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-objective-apply-rejection-'));
  const stdoutPath = path.join(fixtureDir, 'run.stdout.json');
  const applyReason = `Structured content preflight rejected \`package.json\` because the candidate JSON is not parseable: ${'trailing-content '.repeat(24).trim()}`;
  writeJson(stdoutPath, {
    run: {
      status: 'objective_proposal_apply_rejected',
      objective_apply_operation: 'patch_file',
      objective_apply_path: 'package.json',
      objective_apply_apply_status: 'Denied',
      objective_apply_apply_reason: applyReason,
      objective_apply_applied: false,
      objective_apply_authorization_consumed: false,
      objective_apply_failed_checks: ['structured_content_parseable'],
      objective_apply_blocked_checks: []
    }
  });
  const feedback = JSON.parse(execFileSync('python3', [
    '-c',
    feedbackBuilder,
    stdoutPath,
    'scripts/release-artifact-runtime-journey.test.mjs'
  ], { encoding: 'utf8' }));

  assert.equal(feedback.reason, 'objective_apply_rejected_before_write');
  assert.equal(feedback.repair_mode, 'structured_candidate_repair');
  assert.equal(feedback.selected_target_path, 'package.json');
  assert.equal(feedback.selected_target_path_source, 'runtime_objective_apply');
  assert.equal(feedback.objective_apply.reason, applyReason);
  assert.deepEqual(feedback.objective_apply.failed_checks, ['structured_content_parseable']);
  assert(feedback.semantic_repair_policy.forbidden_next_actions.includes('retry the same rejected candidate'));
  assert(feedback.semantic_repair_policy.forbidden_next_actions.includes('redirect repair to an unrelated first Patch-only target'));

  const runtimeRun = controller.indexOf('_run_brownie_once()');
  const feedbackRoute = controller.indexOf('runtime_stdout_objective_apply_rejection_feedback "$stdout_log" "$active_target_path"', runtimeRun);
  const integrityRoute = controller.indexOf('validate_phase_loop_progress_integrity_after_runtime_apply "$run_stamp"', runtimeRun);
  assert.ok(feedbackRoute > runtimeRun);
  assert.ok(feedbackRoute < integrityRoute);
});

test('expands optional snapshot arguments safely and rejects incomplete snapshot configuration', () => {
  const controller = fs.readFileSync(path.join(repositoryRoot, 'phase-loop.sh'), 'utf8');
  const preflightFunction = controller.indexOf('run_phase_loop_preflight()');
  const preflightBody = controller.slice(preflightFunction, controller.indexOf('\n}\n\n', preflightFunction) + 3);
  assert.match(preflightBody, /phase_loop_preflight_snapshot_audit_missing=true/u);
  assert.match(preflightBody, /\$\{snapshot_args\[@\]\+"\$\{snapshot_args\[@\]\}"\}/u);
  assert.doesNotMatch(preflightBody, /"\$\{snapshot_args\[@\]\}"\s*\n\s*2>&1/u);
});

test('limits runtime admission payload fabrication to the claim-smoke fixture profile', () => {
  const controller = fs.readFileSync(path.join(repositoryRoot, 'phase-loop.sh'), 'utf8');
  const fabrication = controller.indexOf('node --input-type=module - "$stdout_log" "$runtime_admission_snapshot"');
  assert(fabrication >= 0);
  const guard = controller.lastIndexOf('if [', fabrication);
  assert.match(controller.slice(guard, fabrication), /\$PHASE_LOOP_PREFLIGHT_PROFILE.*claim-smoke-fixture/);
  assert.match(controller.slice(guard, fabrication), /PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY:-0\}\" = \"1\"/);
});

test('bounded implementation leaves are not instructed to re-split their TODO on missing patch context', () => {
  const prompt = fs.readFileSync(path.join(repositoryRoot, 'phase-loop.md'), 'utf8');
  assert.match(prompt, /This is allowed only when the\s+selected TODO is not already a bounded leaf with explicit patch targets\./);
  assert.match(prompt, /bounded leaf with explicit patch targets, never rewrite `\.brownie\/todo\.md` to\s+create children solely because the visible context is insufficient\./);
  assert.match(prompt, /either emit one safe patch restricted\s+to those targets, or report a concrete external\/owner blocker/);
});

test('bounded leaf oversized recovery never redirects to the TODO queue', () => {
  const controller = fs.readFileSync(path.join(repositoryRoot, 'phase-loop.sh'), 'utf8');
  assert.match(controller, /oversized or truncated\. The next tool must be exactly one smaller complete `workspace\.write` patch_file/);
  assert.match(controller, /oversized bounded-leaf repair is active[\s\S]{0,260}do not write `\.brownie\/todo\.md`/);
  assert.doesNotMatch(controller, /leaf_oversized_repair_leaf_template/);
});

test('ordinary leaf repair keeps the direct-write path when target context is available', () => {
  const controller = fs.readFileSync(path.join(repositoryRoot, 'phase-loop.sh'), 'utf8');
  assert.match(controller, /or not leaf_has_oversized_repair/);
  assert.match(controller, /leaf_required_next_tool_policy: the next tool must be `workspace\.write`/);
});
