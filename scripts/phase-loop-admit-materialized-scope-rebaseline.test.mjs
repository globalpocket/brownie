import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { admitMaterializedScopeRebaseline, readGitMaterializedScopeRebaselineRecords, readVerifiedActiveClaimDurableApply, validateMaterializedScopeRebaseline } from './phase-loop-admit-materialized-scope-rebaseline.mjs';
import { validateTodoDecompositionText } from './guard-todo-decomposition.mjs';

function contract(firstLine) {
  return { id: 'E-fixture', first_line: firstLine, route: 'implementation', depends_on: '<none>', completion_condition: 'complete', forbidden_changes: 'none', verification: 'run `node --test`' };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-materialized-scope-'));
  const target = 'scripts/journey.mjs';
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, target), '// placeholder\n');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, target), 'utf8').trim(), 'utf8').digest('hex');
  const records = [{ target_todo_ids: ['E-fixture'], target_capture: { mode: 'legacy_pre_capture_materialization' }, target_snapshots: [{ operation: 'Create', path: target, exists_after: true, sha256_after: sha256 }] }];
  return { root, target, records };
}

test('admits only a captured Create-to-Patch materialization without target expansion', () => {
  const { root, target, records } = fixture();
  const snapshots = validateMaterializedScopeRebaseline({
    beforeContract: contract(`- [ ] E-fixture: Create only \`${target}\`, then patch only \`package.json\`:`),
    afterContract: contract(`- [ ] E-fixture: Patch only \`${target}\`, then patch only \`package.json\`:`),
    repoRoot: root,
    records
  });
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].path, target);
});

test('rejects added scope and uncaptured content', () => {
  const { root, target, records } = fixture();
  assert.throws(() => validateMaterializedScopeRebaseline({
    beforeContract: contract(`- [ ] E-fixture: Create only \`${target}\`:`),
    afterContract: contract(`- [ ] E-fixture: Patch only \`${target}\` and \`package.json\`:`),
    repoRoot: root,
    records
  }), /add, remove, or replace/u);
  fs.writeFileSync(path.join(root, target), '// changed\n');
  assert.throws(() => validateMaterializedScopeRebaseline({
    beforeContract: contract(`- [ ] E-fixture: Create only \`${target}\`:`),
    afterContract: contract(`- [ ] E-fixture: Patch only \`${target}\`:`),
    repoRoot: root,
    records
  }), /not bound/u);
});

test('writes an exact receipt for a captured Create-to-Patch contract drift', () => {
  const { root, target, records } = fixture();
  const before = `- [ ] E-fixture: Create only \`${target}\`, then patch only \`package.json\`:\n  Route: implementation.\n  Depends on: <none>.\n  Completion condition: complete.\n  Forbidden changes: none.\n  Verification: run \`node --test\`.\n`;
  const after = before.replace(`Create only \`${target}\`, then patch only \`package.json\``, `Patch only \`package.json\`, then patch only \`${target}\``);
  fs.mkdirSync(path.join(root, '.brownie'), { recursive: true });
  fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-claims/contract-rebaselines'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, '.brownie/todo.md'), before);
  fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'Dependency graph:\n');
  fs.writeFileSync(path.join(root, 'scripts/guard-todo-decomposition.mjs'), 'process.exit(0);\n');
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['add', '.brownie/todo.md', '.brownie/todo-breakdown.md'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=Brownie', '-c', 'user.email=brownie@example.invalid', 'commit', '-m', 'baseline'], { cwd: root, stdio: 'ignore' });
  fs.writeFileSync(path.join(root, '.brownie/todo.md'), after);
  fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/contract-rebaselines/capture.json'), `${JSON.stringify(records[0])}\n`);
  const result = admitMaterializedScopeRebaseline({
    repoRoot: root,
    baselineRef: 'HEAD',
    todoId: 'E-fixture',
    runStamp: 'fixture-run',
    eventKey: 'fixture-event',
    diagnostic: 'fixture recovery'
  });
  assert.equal(result.applied, true);
  assert.equal(result.target_snapshots[0].path, target);
  assert.equal(fs.existsSync(path.join(root, result.receipt_path)), true);
});

function gitMergedMaterializationFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-git-materialization-'));
  const id = 'E-fixture';
  const target = 'scripts/journey.mjs';
  const baseTodo = `- [ ] ${id}: Create only \`${target}\`:\n  Route: implementation.\n  Source TODO: E-parent.\n  Depends on: <none>.\n  Completion condition: the bounded implementation is complete and independently verified.\n  Forbidden changes: do not edit unrelated release evidence files.\n  Verification: run \`pnpm --workspace-root guard:release-contract:test\`.\n`;
  fs.mkdirSync(path.join(root, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(root, '.brownie/todo.md'), baseTodo);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Brownie'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'brownie@example.invalid'], { cwd: root });
  execFileSync('git', ['add', '.brownie/todo.md'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: root });
  execFileSync('git', ['checkout', '-qb', 'implementation'], { cwd: root });
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, target), 'export const journey = true;\n');
  execFileSync('git', ['add', target], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'implement fixture TODO E-fixture'], { cwd: root });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: root });
  execFileSync('git', ['merge', '--no-ff', '-qm', 'merge implementation', 'implementation'], { cwd: root });
  const merge = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const blob = execFileSync('git', ['rev-parse', `HEAD:${target}`], { cwd: root, encoding: 'utf8' }).trim();
  const receipt = `  Materialization receipt: Git merged Create-to-Patch v1; TODO ${id}; PR #123; merge commit ${merge}; PR head ${head}; targets \`${target}@${blob}\`.\n`;
  fs.writeFileSync(path.join(root, '.brownie/todo.md'), baseTodo.replace(`Create only \`${target}\``, `Patch only \`${target}\``) + receipt);
  execFileSync('git', ['checkout', '-qb', 'followup'], { cwd: root });
  fs.writeFileSync(path.join(root, 'followup.txt'), 'followup\n');
  execFileSync('git', ['add', 'followup.txt'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'followup'], { cwd: root });
  const followupHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: root });
  fs.writeFileSync(path.join(root, 'main.txt'), 'main advance\n');
  execFileSync('git', ['add', 'main.txt'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'advance main'], { cwd: root });
  execFileSync('git', ['merge', '--no-ff', '-qm', 'merge followup', 'followup'], { cwd: root });
  const laterMerge = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  execFileSync('git', ['branch', '-f', 'materialization', merge], { cwd: root });
  return { root, id, target, merge, head, blob, laterMerge, followupHead };
}

function shallowCloneWithReceipt(sourceRoot, branch, todoText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-git-materialization-shallow-'));
  execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', branch, `file://${sourceRoot}`, root]);
  fs.writeFileSync(path.join(root, '.brownie/todo.md'), todoText);
  return root;
}

test('admits a public Git-merged Create-to-Patch receipt only for the exact target and TODO', () => {
  const { root, id, target } = gitMergedMaterializationFixture();
  const records = readGitMaterializedScopeRebaselineRecords(root);
  assert.equal(records.length, 1);
  assert.equal(records[0].target_todo_ids[0], id);
  assert.equal(records[0].contract_changes[0].before_contract.first_line.includes(`Create only \`${target}\``), true);
  const text = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
  assert.deepEqual(validateTodoDecompositionText(text, {
    repoRoot: root,
    packageScripts: new Set(['guard:release-contract:test'])
  }), []);
});

test('admits a clean committed bounded Patch after a public Create-to-Patch receipt but rejects a dirty target mutation', () => {
  const { root, target } = gitMergedMaterializationFixture();
  const todoPath = path.join(root, '.brownie/todo.md');
  execFileSync('git', ['add', '.brownie/todo.md'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'publish public materialization receipt'], { cwd: root });
  execFileSync('git', ['checkout', '-qb', 'implementation-patch'], { cwd: root });
  fs.writeFileSync(path.join(root, target), 'export const journey = "clean-committed-patch";\n');
  execFileSync('git', ['add', target], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'patch bounded E-fixture implementation'], { cwd: root });

  const todoText = fs.readFileSync(todoPath, 'utf8');
  assert.equal(readGitMaterializedScopeRebaselineRecords(root, todoText).length, 1);
  assert.deepEqual(validateTodoDecompositionText(todoText, {
    repoRoot: root,
    packageScripts: new Set(['guard:release-contract:test'])
  }), []);

  fs.writeFileSync(path.join(root, target), 'export const journey = "dirty-mutation";\n');
  assert.throws(
    () => readGitMaterializedScopeRebaselineRecords(root, todoText),
    /receipt target digest mismatch in current worktree/u
  );
});

test('rejects a clean committed target Patch when its introducing commit expands beyond the bounded scope', () => {
  const { root, target } = gitMergedMaterializationFixture();
  const todoPath = path.join(root, '.brownie/todo.md');
  execFileSync('git', ['add', '.brownie/todo.md'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'publish public materialization receipt'], { cwd: root });
  fs.writeFileSync(path.join(root, target), 'export const journey = "scope-expanded-patch";\n');
  fs.writeFileSync(path.join(root, 'outside-bounded-scope.txt'), 'must not be admitted\n');
  execFileSync('git', ['add', target, 'outside-bounded-scope.txt'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'patch target with unrelated scope expansion'], { cwd: root });

  assert.throws(
    () => readGitMaterializedScopeRebaselineRecords(root, fs.readFileSync(todoPath, 'utf8')),
    /receipt target digest mismatch in current worktree/u
  );
});

test('rejects a merge that hides an out-of-scope current-blob introduction behind a bounded parent-pair delta', () => {
  const { root, target } = gitMergedMaterializationFixture();
  const todoPath = path.join(root, '.brownie/todo.md');
  execFileSync('git', ['add', '.brownie/todo.md'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'publish public materialization receipt'], { cwd: root });
  execFileSync('git', ['checkout', '-qb', 'bad-introducer'], { cwd: root });
  fs.writeFileSync(path.join(root, target), 'export const journey = "hidden-out-of-scope-introduction";\n');
  fs.writeFileSync(path.join(root, 'outside-bounded-scope.txt'), 'shared outside change\n');
  execFileSync('git', ['add', target, 'outside-bounded-scope.txt'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'introduce target with outside scope'], { cwd: root });
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: root });
  fs.writeFileSync(path.join(root, 'outside-bounded-scope.txt'), 'shared outside change\n');
  execFileSync('git', ['add', 'outside-bounded-scope.txt'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'independently add outside scope'], { cwd: root });
  execFileSync('git', ['merge', '--no-ff', '-qm', 'merge target introduction', 'bad-introducer'], { cwd: root });

  assert.throws(
    () => readGitMaterializedScopeRebaselineRecords(root, fs.readFileSync(todoPath, 'utf8')),
    /receipt target digest mismatch in current worktree/u
  );
});

test('rejects a Git materialization receipt when parent presence, digest, or TODO binding is wrong', () => {
  const { root, target, merge, head, blob, laterMerge, followupHead } = gitMergedMaterializationFixture();
  const todoPath = path.join(root, '.brownie/todo.md');
  const original = fs.readFileSync(todoPath, 'utf8');
  fs.writeFileSync(todoPath, original.replace(`merge commit ${merge}; PR head ${head}`, `merge commit ${laterMerge}; PR head ${followupHead}`));
  assert.throws(() => readGitMaterializedScopeRebaselineRecords(root), /exists in merge first parent/u);
  fs.writeFileSync(todoPath, original.replace(`PR head ${head}`, `PR head ${merge}`));
  assert.throws(() => readGitMaterializedScopeRebaselineRecords(root), /not the merged implementation parent/u);
  fs.writeFileSync(todoPath, original.replace(blob, '0000000000000000000000000000000000000000'));
  assert.throws(() => readGitMaterializedScopeRebaselineRecords(root), /digest mismatch/u);
  fs.writeFileSync(todoPath, original.replace('TODO E-fixture', 'TODO E-other'));
  assert.throws(() => readGitMaterializedScopeRebaselineRecords(root), /TODO binding mismatch/u);
  // Keep the fixture target referenced above so a future parser cannot ignore
  // an otherwise valid target list while accepting a mismatched binding.
  assert.equal(fs.existsSync(path.join(root, target)), true);
});

test('liveness admits only an exact active-claim durable apply over an unchanged public receipt target', () => {
  const { root, target } = gitMergedMaterializationFixture();
  const todoPath = path.join(root, '.brownie/todo.md');
  const selectedTodo = fs.readFileSync(todoPath, 'utf8').trimEnd();
  const selectedTodoSha256 = crypto.createHash('sha256').update(selectedTodo).digest('hex');
  const stateRoot = path.join(root, '.brownie/private/phase-loop');
  const claimPath = path.join(stateRoot, 'todo-claims/current.json');
  const runStamp = 'fixture-runtime-apply';
  const claimId = 'todo-g701-fixture-r1';
  const queue = { generation: 701, fingerprint: 'fixture-active-queue' };
  const runtimeBytes = 'export const journey = "runtime-applied";\n';
  fs.writeFileSync(path.join(root, target), runtimeBytes);
  const postWriteTargetSha256 = crypto.createHash('sha256').update(runtimeBytes).digest('hex');
  const stdoutPath = path.join(stateRoot, 'runs', `${runStamp}.stdout.log`);
  const evidencePath = path.join(stateRoot, 'runs', `${runStamp}.execution-evidence.json`);
  const writeJson = (filePath, value) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  };
  writeJson(claimPath, {
    claim_id: claimId, status: 'in_progress', selected_todo: selectedTodo,
    queue_generation: queue.generation, queue_fingerprint: queue.fingerprint,
    run_stamp: runStamp, terminal_failure_execution_evidence_path: evidencePath
  });
  writeJson(path.join(stateRoot, 'todo-claims/todo-queue-state.json'), queue);
  writeJson(path.join(stateRoot, 'runs', `${runStamp}.runtime-admission.json`), {
    status: 'admitted', claim_id: claimId, selected_todo_id: 'E-fixture', selected_todo_sha256: selectedTodoSha256,
    queue_generation: queue.generation, queue_fingerprint: queue.fingerprint
  });
  writeJson(stdoutPath, { run: {
    status: 'objective_proposal_applied', task_execution_confirmed: true, phase_loop_claim_id: claimId,
    phase_loop_selected_todo_sha256: selectedTodoSha256, phase_loop_queue_generation: queue.generation,
    phase_loop_queue_fingerprint: queue.fingerprint, objective_apply_applied: true, objective_apply_path: target
  } });
  writeJson(evidencePath, {
    run_stamp: runStamp, claim_id: claimId, runtime_claim_id: claimId, claim_matches: true,
    selected_todo_id: 'E-fixture', selected_todo_sha256: selectedTodoSha256, task_execution_confirmed: true,
    target_files: [target], stdout_path: stdoutPath,
    durable_apply_evidence: {
      schema_version: 1, claim_id: claimId, runtime_claim_id: claimId,
      selected_todo_id: 'E-fixture', selected_todo_sha256: selectedTodoSha256, runtime_run_stamp: runStamp,
      queue_generation: queue.generation, queue_fingerprint: queue.fingerprint, target_path: target, post_write_target_sha256: postWriteTargetSha256
    }
  });

  const durableApply = readVerifiedActiveClaimDurableApply({ repoRoot: root, stateRoot, claimPath, stage: 'pre-completion', todoText: selectedTodo });
  assert.equal(durableApply?.claim_id, claimId);
  assert.equal(durableApply?.materializations[0]?.post_write_target_sha256, postWriteTargetSha256);
  assert.equal(readGitMaterializedScopeRebaselineRecords(root, selectedTodo, { activeClaimMaterialization: durableApply }).length, 1);
  assert.deepEqual(validateTodoDecompositionText(selectedTodo, {
    repoRoot: root, packageScripts: new Set(['guard:release-contract:test']), stateRoot, claimPath, stage: 'pre-completion'
  }), []);
  assert.equal(JSON.parse(fs.readFileSync(claimPath, 'utf8')).status, 'in_progress', 'liveness reaches continuation without completion');

  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  evidence.stdout_path = path.join(stateRoot, '..', 'outside-state.json');
  writeJson(evidencePath, evidence);
  assert.equal(readVerifiedActiveClaimDurableApply({ repoRoot: root, stateRoot, claimPath, stage: 'pre-completion', todoText: selectedTodo }), null);
  evidence.stdout_path = stdoutPath;
  writeJson(evidencePath, evidence);

  const outsideStateArtifact = path.join(os.tmpdir(), `brownie-state-artifact-escape-${process.pid}.json`);
  fs.writeFileSync(outsideStateArtifact, fs.readFileSync(stdoutPath));
  fs.rmSync(stdoutPath);
  fs.symlinkSync(outsideStateArtifact, stdoutPath);
  assert.equal(
    readVerifiedActiveClaimDurableApply({ repoRoot: root, stateRoot, claimPath, stage: 'pre-completion', todoText: selectedTodo }),
    null,
    'a lexical in-state path may not dereference a state-root escape symlink'
  );
  fs.unlinkSync(stdoutPath);
  writeJson(stdoutPath, { run: {
    status: 'objective_proposal_applied', task_execution_confirmed: true, phase_loop_claim_id: claimId,
    phase_loop_selected_todo_sha256: selectedTodoSha256, phase_loop_queue_generation: queue.generation,
    phase_loop_queue_fingerprint: queue.fingerprint, objective_apply_applied: true, objective_apply_path: target
  } });
  fs.rmSync(outsideStateArtifact, { force: true });

  fs.writeFileSync(path.join(root, target), 'export const journey = "manual-drift";\n');
  assert.equal(readVerifiedActiveClaimDurableApply({ repoRoot: root, stateRoot, claimPath, stage: 'pre-completion', todoText: selectedTodo }), null);
  assert.throws(() => readGitMaterializedScopeRebaselineRecords(root, selectedTodo), /digest mismatch in current worktree/u);
});

test('fails closed with an actionable full-history error when a public materialization receipt is unavailable in a shallow checkout', () => {
  const { root, merge } = gitMergedMaterializationFixture();
  const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
  const missingParents = shallowCloneWithReceipt(root, 'materialization', todoText);
  const missingCommit = shallowCloneWithReceipt(root, 'main', todoText);

  assert.throws(
    () => readGitMaterializedScopeRebaselineRecords(missingParents),
    new RegExp(`Git history unavailable for merge parents of ${merge}; fetch complete history \\(for example actions/checkout with fetch-depth: 0\\)`, 'u')
  );
  assert.throws(
    () => readGitMaterializedScopeRebaselineRecords(missingCommit),
    new RegExp(`Git history unavailable for merge commit ${merge}; fetch complete history \\(for example actions/checkout with fetch-depth: 0\\)`, 'u')
  );
});

test('CI check job retains complete history for public materialization receipt validation', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const checkStart = workflow.indexOf('  check:');
  const checkEnd = workflow.indexOf('\n  runtime-platform:', checkStart);
  const checkJob = workflow.slice(checkStart, checkEnd);
  const checkoutPin = 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4';

  assert(checkStart >= 0 && checkEnd > checkStart, 'CI check job must exist');
  assert(checkJob.includes(`uses: ${checkoutPin}`), 'CI check job must retain the pinned checkout action');
  assert.match(checkJob, /uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4\n\s+with:\n(?:\s*#.*\n)*\s+fetch-depth: 0/u);
  assert.match(checkJob, /git fetch --no-tags origin main:refs\/remotes\/origin\/main/u);
});
