import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { targetScopes } from './phase-loop-preclaim-recovery.mjs';

const repositoryRoot = path.resolve(new URL('..', import.meta.url).pathname);
const recoveryScript = path.join(repositoryRoot, 'scripts/phase-loop-preclaim-recovery.mjs');

function makeFixture({ repairableCycle = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-preclaim-recovery-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts/a.test.mjs'), '// materialized target\n');
  fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-claims'), { recursive: true });
  fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-replans'), { recursive: true });
  for (const file of ['guard-todo-decomposition.mjs', 'phase-loop-todo-state.mjs', 'phase-loop-historical-derived-delivery-integrity.mjs', 'phase-loop-bounded-scope.mjs', 'repair-todo-decomposition.mjs']) {
    fs.copyFileSync(path.join(repositoryRoot, 'scripts', file), path.join(root, 'scripts', file));
  }
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    scripts: { 'guard:todo-decomposition': 'node scripts/guard-todo-decomposition.mjs' }
  }) + '\n');
  fs.writeFileSync(path.join(root, '.github/workflows/release.yml'), 'name: fixture\n');
  fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-replans/split.json'), JSON.stringify({
    schema_version: 1,
    record_type: 'todo_replan',
    operation: 'split_parent_into_children',
    parent_status: 'superseded_by_children',
    parent_todo_id: 'E-23b-release-artifact-download-roundtrip',
    generated_child_ids: [
      'E-23b-release-artifact-download-roundtrip-target-01',
      'E-23b-release-artifact-download-roundtrip-target-02',
      'E-23b-release-artifact-download-roundtrip-target-03',
      'E-23b-release-artifact-download-roundtrip-target-04'
    ]
  }) + '\n');
  const source = 'E-23b-release-artifact-download-roundtrip';
  const leaf = (suffix, target, dependency, verification = 'pnpm --workspace-root guard:todo-decomposition') => `- [ ] ${source}-target-${suffix}: Create only \`${target}\` for the downloaded roundtrip:\n`
    + '  Route: implementation.\n'
    + `  Source TODO: ${source}.\n`
    + `  Depends on: ${dependency || '<none>'}.\n`
    + `  Completion condition: Create only \`${target}\` for the fixture.\n`
    + '  Forbidden changes: do not edit unrelated files.\n'
    + `  Verification: run \`${verification}\`.`;
  const target01 = `${source}-target-01`;
  const target02 = `${source}-target-02`;
  const target03 = `${source}-target-03`;
  const target04 = `${source}-target-04`;
  const cycleVerification = repairableCycle ? 'node --test scripts/a.test.mjs' : 'pnpm --workspace-root guard:todo-decomposition';
  const target01Block = leaf('01', 'scripts/a.mjs', target02, cycleVerification);
  const target02Block = leaf('02', 'scripts/a.test.mjs', target01, cycleVerification);
  const target03Block = leaf('03', 'package.json', target02);
  const target04Block = leaf('04', '.github/workflows/release.yml', target03);
  const runtimeBlock = `- [ ] E-23c-release-artifact-runtime-journey: Create only \`scripts/c.mjs\` after the artifact roundtrip:\n`
    + '  Route: implementation.\n'
    + '  Source TODO: 2026-10-06 external review.\n'
    + `  Depends on: ${source}.\n`
    + '  Completion condition: create the fixture.\n'
    + '  Forbidden changes: do not edit unrelated files.\n'
    + '  Verification: run `pnpm --workspace-root guard:todo-decomposition`.';
  fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
    `- [x] ${source}: Parent fixture.`, '', target01Block, '', target02Block, '', target03Block, '', target04Block, '', runtimeBlock, ''
  ].join('\n'));
  fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
    '# TODO breakdown', '', '## E-23b split', '', `Parent TODO: ${source}`, '', 'Dependency graph:',
    `- ${target01}: ${target02}`, `- ${target02}: ${target01}`, `- ${target03}: ${target02}`, `- ${target04}: ${target03}`, '- E-23c-release-artifact-runtime-journey: E-23b-release-artifact-download-roundtrip',
    '', 'Verification ledger:', `- ${target01}: guard`, `- ${target02}: guard`, `- ${target03}: guard`, `- ${target04}: guard`, '- E-23c-release-artifact-runtime-journey: guard', '', 'Quality rubric:', '- Each leaf has one concrete target.', '', 'History:', '- fixture', ''
  ].join('\n'));
  fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
    claim_id: 'fixture-claim',
    selected_todo: target01Block
  }) + '\n');
  return root;
}

function runRecovery(root, diagnostic, maxRetries = '3', baselineRef = null) {
  const args = [
    recoveryScript,
    '--repo', root,
    '--todo', '.brownie/todo.md',
    '--breakdown', '.brownie/todo-breakdown.md',
    '--claim', '.brownie/private/phase-loop/todo-claims/current.json',
    '--state-dir', path.join(root, '.brownie/private/phase-loop'),
    '--run-stamp', 'fixture-run',
    '--max-retries', maxRetries,
    '--diagnostic', diagnostic
  ];
  if (baselineRef) args.push('--baseline-ref', baselineRef);
  return spawnSync(process.execPath, args, { cwd: repositoryRoot, encoding: 'utf8' });
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function recoveryRecord(root) {
  const recoveryRoot = path.join(root, '.brownie/private/phase-loop/preclaim-recovery');
  const directory = fs.readdirSync(recoveryRoot, { withFileTypes: true }).find((entry) => entry.isDirectory());
  assert.ok(directory, 'expected recovery record directory');
  const recordPath = path.join(recoveryRoot, directory.name, 'record.json');
  return { recordPath, record: JSON.parse(fs.readFileSync(recordPath, 'utf8')) };
}

function makeExactPlaceholderFixture() {
  const root = makeFixture({ repairableCycle: false });
  const todo = '- [ ] E-placeholder: Patch only `.github/workflows/release.yml`:\n'
    + '  Route: implementation.\n'
    + '  Source TODO: fixture source.\n'
    + '  Depends on: <none>.\n'
    + '  Completion condition: Restore only an exact bounded placeholder to the approved tracked release workflow so the selected TODO can be scheduled.\n'
    + '  Forbidden changes: do not edit unrelated files.\n'
    + '  Verification: run `pnpm --workspace-root guard:todo-decomposition`.\n';
  const breakdown = '# TODO breakdown\n\nParent TODO: fixture source.\n\nDependency graph:\n- E-placeholder: <none>.\n\nVerification ledger:\n- E-placeholder: guard.\n\nQuality rubric:\n- One bounded leaf.\n';
  const baseline = 'name: fixture\n';
  fs.writeFileSync(path.join(root, '.brownie/todo.md'), todo);
  fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), breakdown);
  fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
    claim_id: 'placeholder-claim',
    selected_todo: todo.trim()
  }) + '\n');
  fs.writeFileSync(path.join(root, '.github/workflows/release.yml'), baseline);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Fixture']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'fixture baseline']);
  const placeholder = '// Brownie bounded Patch-only proposal.\n';
  fs.writeFileSync(path.join(root, '.github/workflows/release.yml'), placeholder);
  return { root, baseline, placeholder };
}

test('repairs reparable pre-claim decomposition drift and records a reversible transaction', () => {
  const root = makeFixture();
  const diagnostic = 'node scripts/guard-todo-decomposition.mjs: Create only target already exists; TODO dependencies must not contain cycles; dependency E-23b-release-artifact-download-roundtrip is present only in the breakdown ledger';
  const result = runRecovery(root, diagnostic);
  const recoveryRoot = path.join(root, '.brownie/private/phase-loop/preclaim-recovery');
  const recoveryDirectory = fs.existsSync(recoveryRoot) ? fs.readdirSync(recoveryRoot, { withFileTypes: true }).find((entry) => entry.isDirectory()) : null;
  const recoveryRecord = recoveryDirectory ? fs.readFileSync(path.join(recoveryRoot, recoveryDirectory.name, 'record.json'), 'utf8') : '<none>';
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\nrecord=${recoveryRecord}`);
  const guard = spawnSync(process.execPath, ['scripts/guard-todo-decomposition.mjs'], { cwd: root, encoding: 'utf8' });
  const recoveryRecordPath = path.join(recoveryRoot, fs.readdirSync(recoveryRoot, { withFileTypes: true }).find((entry) => entry.isDirectory()).name, 'record.json');
  assert.equal(guard.status, 0, `${guard.stdout}${guard.stderr}\nrecovery=${result.stdout}${result.stderr}\nrecord=${fs.readFileSync(recoveryRecordPath, 'utf8')}`);
  const recordPath = fs.readdirSync(path.join(root, '.brownie/private/phase-loop/preclaim-recovery'), { withFileTypes: true })
    .find((entry) => entry.isDirectory());
  const record = JSON.parse(fs.readFileSync(path.join(root, '.brownie/private/phase-loop/preclaim-recovery', recordPath.name, 'record.json'), 'utf8'));
  assert.equal(record.status, 'applied');
  assert.equal(record.rollback_performed, false);
  assert.equal(record.attempts.length, 1);
  assert.equal(record.claim_snapshot.selected_todo_first_line.startsWith('- [ ] E-23b-release-artifact-download-roundtrip-target-01'), true);
  assert.equal(record.target_snapshot.length, 5);
  assert.deepEqual(record.target_snapshot.map((target) => target.path).sort(), [
    '.github/workflows/release.yml',
    'package.json',
    'scripts/a.mjs',
    'scripts/a.test.mjs',
    'scripts/c.mjs'
  ]);
  assert.equal(record.target_snapshot.find((target) => target.path === 'scripts/a.mjs')?.exists_before, false);
  assert.notEqual(record.before.todo_sha256, record.after.todo_sha256);
  const repairedTodo = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
  assert.match(repairedTodo, /Completion condition: Patch only `scripts\/a\.test\.mjs` for the fixture\./u);
  assert.doesNotMatch(repairedTodo, /Completion condition: Create only `scripts\/a\.test\.mjs`/u);
  assert.match(record.contract_rebaseline_receipt, /contract-rebaselines/u);
  const contractReceipt = JSON.parse(fs.readFileSync(path.join(root, record.contract_rebaseline_receipt), 'utf8'));
  assert.equal(contractReceipt.status, 'approved');
  assert.equal(contractReceipt.cause_run.run_stamp, 'fixture-run');
  assert.equal(contractReceipt.verification.guard_passed, true);
  assert.equal(contractReceipt.target_snapshots.length, 5);
  fs.copyFileSync(record.rollback_snapshot.todo, path.join(root, '.brownie/todo.md'));
  fs.copyFileSync(record.rollback_snapshot.breakdown, path.join(root, '.brownie/todo-breakdown.md'));
  const repeated = runRecovery(root, diagnostic);
  assert.equal(repeated.status, 2);
});

test('resumes an interrupted started recovery after rolling back its snapshot', () => {
  const root = makeFixture();
  const todoPath = path.join(root, '.brownie/todo.md');
  const diagnostic = 'node scripts/guard-todo-decomposition.mjs: Create only target already exists; TODO dependencies must not contain cycles; dependency E-23b-release-artifact-download-roundtrip is present only in the breakdown ledger';
  const repairScript = path.join(root, 'scripts/repair-todo-decomposition.mjs');
  const repairScriptSource = fs.readFileSync(repairScript, 'utf8');
  fs.writeFileSync(repairScript, `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(todoPath)}, 'interrupted before repair completed\\n');\nprocess.kill(process.pid, 'SIGKILL');\n`);

  const interrupted = runRecovery(root, diagnostic);
  assert.equal(interrupted.status, null);
  assert.equal(interrupted.signal, 'SIGKILL');
  assert.equal(fs.readFileSync(todoPath, 'utf8'), 'interrupted before repair completed\n');
  fs.writeFileSync(repairScript, repairScriptSource);

  const resumed = runRecovery(root, diagnostic);
  assert.equal(resumed.status, 0, `${resumed.stdout}\n${resumed.stderr}`);
  const recoveryRoot = path.join(root, '.brownie/private/phase-loop/preclaim-recovery');
  const recoveryDirectory = fs.readdirSync(recoveryRoot, { withFileTypes: true }).find((entry) => entry.isDirectory());
  const record = JSON.parse(fs.readFileSync(path.join(recoveryRoot, recoveryDirectory.name, 'record.json'), 'utf8'));
  assert.equal(record.status, 'applied');
  assert.equal(record.resumed_after_interruption, true);
  assert.equal(record.recovery_resumes.length, 1);
  assert.equal(record.recovery_resumes[0].rollback_performed, true);
  assert.notEqual(fs.readFileSync(todoPath, 'utf8'), 'interrupted before repair completed\n');
});

test('migrates a legacy single-target recovery into an audited hash-bound target capture', () => {
  const root = makeFixture();
  const initialDiagnostic = 'node scripts/guard-todo-decomposition.mjs: Create only target already exists; TODO dependencies must not contain cycles; dependency E-23b-release-artifact-download-roundtrip is present only in the breakdown ledger';
  const repaired = runRecovery(root, initialDiagnostic);
  assert.equal(repaired.status, 0, `${repaired.stdout}\n${repaired.stderr}`);
  const recoveryRoot = path.join(root, '.brownie/private/phase-loop/preclaim-recovery');
  const recoveryDirectory = fs.readdirSync(recoveryRoot, { withFileTypes: true }).find((entry) => entry.isDirectory());
  const recordPath = path.join(recoveryRoot, recoveryDirectory.name, 'record.json');
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const sourceReceiptPath = path.join(root, record.contract_rebaseline_receipt);
  const sourceReceipt = JSON.parse(fs.readFileSync(sourceReceiptPath, 'utf8'));
  delete sourceReceipt.target_snapshots;
  // Historical receipts can group several Create-only targets.  The second
  // target must still be eligible for the hash-bound materialization capture.
  sourceReceipt.contract_changes[0].before_contract.first_line = '- [ ] E-23b-release-artifact-download-roundtrip-target-01: Create only `scripts/a.mjs` and `scripts/a.test.mjs` for the downloaded roundtrip:';
  const target02Change = sourceReceipt.contract_changes.find((entry) => entry.todo_id === 'E-23b-release-artifact-download-roundtrip-target-02');
  assert.ok(target02Change, 'fixture must retain the target-02 rebaseline entry');
  const target02Before = target02Change.before_contract.first_line;
  const target02After = target02Change.after_contract.first_line;
  const target02WithPendingSibling = target02After.replace(
    'Patch only `scripts/a.test.mjs`',
    'Patch only `scripts/a.test.mjs` and Create only `scripts/c.mjs`'
  );
  target02Change.before_contract.first_line = target02Before.replace(
    'Create only `scripts/a.test.mjs`',
    'Create only `scripts/a.test.mjs` and `scripts/c.mjs`'
  );
  target02Change.after_contract.first_line = target02WithPendingSibling;
  fs.writeFileSync(sourceReceiptPath, `${JSON.stringify(sourceReceipt, null, 2)}\n`);
  record.target_snapshot = record.target_snapshot.filter((target) => target.path !== 'scripts/a.test.mjs');
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'scripts/a.test.mjs'), '// Brownie bounded Create-only proposal.\n');
  fs.writeFileSync(path.join(root, 'scripts/c.mjs'), '// Brownie bounded Create-only proposal.\n');
  const todoWithPendingSibling = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8')
    .replace(target02After, target02WithPendingSibling);
  fs.writeFileSync(path.join(root, '.brownie/todo.md'), todoWithPendingSibling);

  const migrated = runRecovery(root, 'phase-loop-preflight.mjs: contract_unsatisfiable_dirty_scope');
  assert.equal(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
  const migratedRecord = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  assert.equal(migratedRecord.legacy_target_materialization_rebaselines.length, 1);
  const migrationReceipt = JSON.parse(fs.readFileSync(path.join(root, migratedRecord.legacy_target_materialization_rebaselines[0]), 'utf8'));
  assert.equal(migrationReceipt.target_capture.mode, 'legacy_pre_capture_materialization');
  assert.deepEqual(migrationReceipt.target_snapshots, [{
    operation: 'Create',
    path: 'scripts/a.test.mjs',
    exists_before: null,
    sha256_before: null,
    exists_after: true,
    sha256_after: migrationReceipt.target_capture.target_sha256
  }]);
  const resumed = runRecovery(root, 'phase-loop-preflight.mjs: contract_unsatisfiable_dirty_scope; Create only target already exists');
  assert.equal(resumed.status, 0, `${resumed.stdout}\n${resumed.stderr}`);
  const resumedTodo = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
  assert.match(resumedTodo, /Patch only `scripts\/a\.test\.mjs` and `scripts\/c\.mjs`/u);
  assert.doesNotMatch(resumedTodo, /Create only `scripts\/c\.mjs`/u);
});

test('parses every joined bounded target before migrating a legacy materialization', () => {
  assert.deepEqual(targetScopes('Create only `scripts/runtime.mjs` and `scripts/runtime.test.mjs`, then patch only `package.json`.'), [
    { operation: 'Create', path: 'scripts/runtime.mjs' },
    { operation: 'Create', path: 'scripts/runtime.test.mjs' }
  ]);
  assert.deepEqual(targetScopes('Patch only `scripts/runtime.test.mjs` and Create only `scripts/runtime.mjs`, then patch only `package.json`.'), [
    { operation: 'Patch', path: 'scripts/runtime.test.mjs' },
    { operation: 'Create', path: 'scripts/runtime.mjs' }
  ]);
});

test('fails closed and records a terminal audit when an interrupted recovery snapshot is missing', () => {
  const root = makeFixture();
  const diagnostic = 'node scripts/guard-todo-decomposition.mjs: Create only target already exists; TODO dependencies must not contain cycles; dependency E-23b-release-artifact-download-roundtrip is present only in the breakdown ledger';
  const repairScript = path.join(root, 'scripts/repair-todo-decomposition.mjs');
  const repairScriptSource = fs.readFileSync(repairScript, 'utf8');
  fs.writeFileSync(repairScript, `process.kill(process.pid, 'SIGKILL');\n`);
  const interrupted = runRecovery(root, diagnostic);
  assert.equal(interrupted.signal, 'SIGKILL');
  fs.writeFileSync(repairScript, repairScriptSource);

  const recoveryRoot = path.join(root, '.brownie/private/phase-loop/preclaim-recovery');
  const recoveryDirectory = fs.readdirSync(recoveryRoot, { withFileTypes: true }).find((entry) => entry.isDirectory());
  const recordPath = path.join(recoveryRoot, recoveryDirectory.name, 'record.json');
  const startedRecord = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  fs.unlinkSync(startedRecord.rollback_snapshot.todo);

  const failed = runRecovery(root, diagnostic);
  assert.equal(failed.status, 1, `${failed.stdout}\n${failed.stderr}`);
  const failedRecord = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  assert.equal(failedRecord.status, 'failed_recovery_snapshot_missing');
  assert.equal(failedRecord.failure_reason, 'recovery_snapshot_missing');
  assert.deepEqual(failedRecord.snapshot_missing, [startedRecord.rollback_snapshot.todo]);

  const repeated = runRecovery(root, diagnostic);
  assert.equal(repeated.status, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(recordPath, 'utf8')), failedRecord);
});

test('rejects non-reparable pre-claim diagnostics without creating recovery evidence', () => {
  const root = makeFixture();
  const result = runRecovery(root, 'node scripts/guard-release-contract.mjs: readiness audit hash mismatch');
  assert.equal(result.status, 2);
  assert.equal(fs.existsSync(path.join(root, '.brownie/private/phase-loop/preclaim-recovery')), false);
});

test('fails closed and restores the preimage when a reparable diagnosis has no safe repair', () => {
  const root = makeFixture({ repairableCycle: false });
  const todoPath = path.join(root, '.brownie/todo.md');
  const breakdownPath = path.join(root, '.brownie/todo-breakdown.md');
  const todoBefore = fs.readFileSync(todoPath, 'utf8');
  const breakdownBefore = fs.readFileSync(breakdownPath, 'utf8');
  const diagnostic = 'node scripts/guard-todo-decomposition.mjs: TODO dependencies must not contain cycles; Create only target already exists';
  const result = runRecovery(root, diagnostic, '1');
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(todoPath, 'utf8'), todoBefore);
  assert.equal(fs.readFileSync(breakdownPath, 'utf8'), breakdownBefore);
  const recoveryRoot = path.join(root, '.brownie/private/phase-loop/preclaim-recovery');
  const recoveryDirectory = fs.readdirSync(recoveryRoot, { withFileTypes: true }).find((entry) => entry.isDirectory());
  const record = JSON.parse(fs.readFileSync(path.join(recoveryRoot, recoveryDirectory.name, 'record.json'), 'utf8'));
  assert.equal(record.status, 'failed_reverted');
  assert.equal(record.rollback_performed, true);
});

test('restores an exact dirty bounded patch placeholder from the configured approved baseline and archives its preimage', () => {
  const { root, baseline, placeholder } = makeExactPlaceholderFixture();
  const diagnostic = 'phase-loop-preflight.mjs: contract_unsatisfiable_dirty_scope';
  const result = runRecovery(root, diagnostic, '3', 'HEAD');
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const targetPath = path.join(root, '.github/workflows/release.yml');
  assert.equal(fs.readFileSync(targetPath, 'utf8'), baseline);
  assert.equal(git(root, ['diff', '--', '.github/workflows/release.yml']), '');
  const { record } = recoveryRecord(root);
  assert.equal(record.status, 'applied');
  assert.equal(record.contract_rebaseline_receipt, undefined);
  assert.equal(record.placeholder_target_restorations.length, 1);
  const restoration = record.placeholder_target_restorations[0];
  assert.equal(restoration.path, '.github/workflows/release.yml');
  assert.equal(restoration.state, 'restored');
  assert.equal(restoration.approved_baseline_ref, 'HEAD');
  assert.equal(restoration.approved_baseline_commit, git(root, ['rev-parse', 'HEAD']).trim());
  assert.equal(fs.readFileSync(path.join(root, restoration.preimage_path), 'utf8'), placeholder);
});

test('does not replace a short proposal marker that contains substantive edits', () => {
  const { root, placeholder } = makeExactPlaceholderFixture();
  const targetPath = path.join(root, '.github/workflows/release.yml');
  const substantiveContent = `${placeholder}name: actual-user-edits\n`;
  fs.writeFileSync(targetPath, substantiveContent);

  const diagnostic = 'phase-loop-preflight.mjs: contract_unsatisfiable_dirty_scope';
  const result = runRecovery(root, diagnostic, '3', 'HEAD');
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), substantiveContent);
  const { record } = recoveryRecord(root);
  assert.equal(record.status, 'failed_reverted');
  assert.equal(record.failure_reason, 'no_effective_recovery');
  assert.equal(record.placeholder_target_recovery_error.reason, 'no_exact_bounded_patch_placeholder');
});

test('does not report success when a dirty bounded patch placeholder lacks an approved baseline selection', () => {
  const { root, placeholder } = makeExactPlaceholderFixture();
  const diagnostic = 'phase-loop-preflight.mjs: contract_unsatisfiable_dirty_scope';
  const result = runRecovery(root, diagnostic);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'), placeholder);
  const { record } = recoveryRecord(root);
  assert.equal(record.status, 'failed_reverted');
  assert.equal(record.failure_reason, 'placeholder_recovery_unavailable');
  assert.equal(record.placeholder_target_recovery_error.reason, 'approved_baseline_missing');
});

test('refuses an approved baseline whose target content differs from the checked-out source baseline', () => {
  const { root, placeholder } = makeExactPlaceholderFixture();
  const targetPath = path.join(root, '.github/workflows/release.yml');
  fs.writeFileSync(targetPath, 'name: diverged\n');
  git(root, ['add', '.github/workflows/release.yml']);
  git(root, ['commit', '-qm', 'diverged checked-out baseline']);
  git(root, ['branch', 'approved-baseline', 'HEAD~1']);
  fs.writeFileSync(targetPath, placeholder);

  const diagnostic = 'phase-loop-preflight.mjs: contract_unsatisfiable_dirty_scope';
  const result = runRecovery(root, diagnostic, '3', 'approved-baseline');
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), placeholder);
  const { record } = recoveryRecord(root);
  assert.equal(record.status, 'failed_reverted');
  assert.equal(record.failure_reason, 'placeholder_recovery_unavailable');
  assert.equal(record.placeholder_target_recovery_error.reason, 'approved_baseline_not_safe_for_placeholder_restore');
});

test('reopens a legacy applied no-op recovery only when its live snapshots still match, then restores the exact placeholder', () => {
  const { root, baseline } = makeExactPlaceholderFixture();
  const diagnostic = 'phase-loop-preflight.mjs: contract_unsatisfiable_dirty_scope';
  const initial = runRecovery(root, diagnostic);
  assert.equal(initial.status, 1, `${initial.stdout}\n${initial.stderr}`);
  const { recordPath, record: legacyRecord } = recoveryRecord(root);
  legacyRecord.status = 'applied';
  legacyRecord.rollback_performed = false;
  legacyRecord.failure_reason = null;
  fs.writeFileSync(recordPath, `${JSON.stringify(legacyRecord, null, 2)}\n`);

  const resumed = runRecovery(root, diagnostic, '3', 'HEAD');
  assert.equal(resumed.status, 0, `${resumed.stdout}\n${resumed.stderr}`);
  assert.equal(fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'), baseline);
  const { record } = recoveryRecord(root);
  assert.equal(record.status, 'applied');
  assert.equal(record.legacy_noop_reopened, true);
  assert.equal(record.recovery_resumes.at(-1).legacy_noop_reopened, true);
  assert.equal(record.placeholder_target_restorations.length, 1);
});

test('resumes a persisted target restoration idempotently after interruption', () => {
  const { root, baseline } = makeExactPlaceholderFixture();
  const diagnostic = 'phase-loop-preflight.mjs: contract_unsatisfiable_dirty_scope';
  const initial = runRecovery(root, diagnostic, '3', 'HEAD');
  assert.equal(initial.status, 0, `${initial.stdout}\n${initial.stderr}`);
  const { recordPath, record: interruptedRecord } = recoveryRecord(root);
  interruptedRecord.status = 'started';
  interruptedRecord.rollback_performed = false;
  interruptedRecord.placeholder_target_restorations[0].state = 'prepared';
  delete interruptedRecord.placeholder_target_restorations[0].restored_at;
  fs.writeFileSync(recordPath, `${JSON.stringify(interruptedRecord, null, 2)}\n`);

  const resumed = runRecovery(root, diagnostic, '3', 'HEAD');
  assert.equal(resumed.status, 0, `${resumed.stdout}\n${resumed.stderr}`);
  assert.equal(fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'), baseline);
  const { record } = recoveryRecord(root);
  assert.equal(record.status, 'applied');
  assert.equal(record.placeholder_target_restorations.length, 1);
  assert.equal(record.placeholder_target_restorations[0].state, 'restored');
  assert.ok(record.placeholder_target_restorations[0].reconciled_after_interruption_at);
  assert.equal(record.recovery_resumes.at(-1).rollback_performed, true);
  assert.equal(record.attempts.at(-1).placeholder_recovery.resumed, true);
  assert.equal(record.attempts.at(-1).placeholder_recovery.reason, 'persisted_target_restorations_verified');
});

test('retries a persisted prepared intent when interruption occurs before replacing its target', () => {
  const { root, baseline, placeholder } = makeExactPlaceholderFixture();
  const diagnostic = 'phase-loop-preflight.mjs: contract_unsatisfiable_dirty_scope';
  const initial = runRecovery(root, diagnostic, '3', 'HEAD');
  assert.equal(initial.status, 0, `${initial.stdout}\n${initial.stderr}`);
  const { recordPath, record: interruptedRecord } = recoveryRecord(root);
  interruptedRecord.status = 'started';
  interruptedRecord.rollback_performed = false;
  interruptedRecord.placeholder_target_restorations[0].state = 'prepared';
  delete interruptedRecord.placeholder_target_restorations[0].restored_at;
  fs.writeFileSync(path.join(root, '.github/workflows/release.yml'), placeholder);
  fs.writeFileSync(recordPath, `${JSON.stringify(interruptedRecord, null, 2)}\n`);

  const resumed = runRecovery(root, diagnostic, '3', 'HEAD');
  assert.equal(resumed.status, 0, `${resumed.stdout}\n${resumed.stderr}`);
  assert.equal(fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'), baseline);
  const { record } = recoveryRecord(root);
  assert.equal(record.status, 'applied');
  assert.equal(record.placeholder_target_restorations.length, 1);
  assert.equal(record.placeholder_target_restorations[0].state, 'restored');
  assert.equal(record.attempts.at(-1).placeholder_recovery.reason, 'exact_bounded_patch_placeholder_restored');
});

test('restores remaining placeholder targets after an interruption between journaled targets', () => {
  const { root, baseline, placeholder } = makeExactPlaceholderFixture();
  const secondTarget = 'scripts/second-placeholder-target.mjs';
  const secondBaseline = 'export const secondTarget = true;\n';
  const secondTodo = '- [ ] E-placeholder-second: Patch only `scripts/second-placeholder-target.mjs`:\n'
    + '  Route: implementation.\n'
    + '  Source TODO: fixture source.\n'
    + '  Depends on: <none>.\n'
    + '  Completion condition: Restore only an exact bounded placeholder to the approved tracked second target.\n'
    + '  Forbidden changes: do not edit unrelated files.\n'
    + '  Verification: run `pnpm --workspace-root guard:todo-decomposition`.\n';
  const todoPath = path.join(root, '.brownie/todo.md');
  const breakdownPath = path.join(root, '.brownie/todo-breakdown.md');
  fs.writeFileSync(path.join(root, secondTarget), secondBaseline);
  fs.appendFileSync(todoPath, `\n${secondTodo}`);
  fs.writeFileSync(breakdownPath, fs.readFileSync(breakdownPath, 'utf8')
    .replace('- E-placeholder: <none>.', '- E-placeholder: <none>.\n- E-placeholder-second: <none>.')
    .replace('- E-placeholder: guard.', '- E-placeholder: guard.\n- E-placeholder-second: guard.'));
  git(root, ['add', '.brownie/todo.md', '.brownie/todo-breakdown.md', secondTarget]);
  git(root, ['commit', '-qm', 'add second placeholder fixture target']);
  fs.writeFileSync(path.join(root, secondTarget), placeholder);

  const diagnostic = 'phase-loop-preflight.mjs: contract_unsatisfiable_dirty_scope';
  const initial = runRecovery(root, diagnostic, '3', 'HEAD');
  assert.equal(initial.status, 0, `${initial.stdout}\n${initial.stderr}`);
  const { recordPath, record: interruptedRecord } = recoveryRecord(root);
  const firstRestoration = interruptedRecord.placeholder_target_restorations.find((restoration) => restoration.path === '.github/workflows/release.yml');
  const secondRestoration = interruptedRecord.placeholder_target_restorations.find((restoration) => restoration.path === secondTarget);
  assert.ok(firstRestoration, 'fixture must record the first restoration');
  assert.ok(secondRestoration, 'fixture must record the second restoration');
  interruptedRecord.status = 'started';
  interruptedRecord.rollback_performed = false;
  interruptedRecord.placeholder_target_restorations = [firstRestoration];
  fs.writeFileSync(path.join(root, secondTarget), placeholder);
  fs.unlinkSync(path.join(root, secondRestoration.preimage_path));
  fs.writeFileSync(recordPath, `${JSON.stringify(interruptedRecord, null, 2)}\n`);

  const resumed = runRecovery(root, diagnostic, '3', 'HEAD');
  assert.equal(resumed.status, 0, `${resumed.stdout}\n${resumed.stderr}`);
  assert.equal(fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'), baseline);
  assert.equal(fs.readFileSync(path.join(root, secondTarget), 'utf8'), secondBaseline);
  const { record } = recoveryRecord(root);
  assert.equal(record.status, 'applied');
  assert.deepEqual(record.placeholder_target_restorations.map((restoration) => restoration.path).sort(), [
    '.github/workflows/release.yml',
    secondTarget
  ]);
  assert.equal(record.placeholder_target_restorations.every((restoration) => restoration.state === 'restored'), true);
  assert.equal(record.attempts.at(-1).placeholder_recovery.reason, 'persisted_target_restorations_verified_and_remaining_placeholders_restored');
});

test('rolls back every persisted restoration when a later recovery retry fails', () => {
  const { root, placeholder } = makeExactPlaceholderFixture();
  const diagnostic = 'phase-loop-preflight.mjs: contract_unsatisfiable_dirty_scope';
  const initial = runRecovery(root, diagnostic, '3', 'HEAD');
  assert.equal(initial.status, 0, `${initial.stdout}\n${initial.stderr}`);
  const { recordPath, record: interruptedRecord } = recoveryRecord(root);
  interruptedRecord.status = 'started';
  interruptedRecord.rollback_performed = false;
  interruptedRecord.placeholder_target_restorations[0].state = 'prepared';
  delete interruptedRecord.placeholder_target_restorations[0].restored_at;
  fs.writeFileSync(path.join(root, '.github/workflows/release.yml'), placeholder);
  fs.writeFileSync(recordPath, `${JSON.stringify(interruptedRecord, null, 2)}\n`);

  fs.writeFileSync(path.join(root, 'scripts/repair-todo-decomposition.mjs'), [
    'export function repairTodoDecomposition() {',
    '  return { applied: true, eligible: true };',
    '}'
  ].join('\n'));
  const guardCounterPath = path.join(root, '.brownie/private/phase-loop/guard-counter');
  fs.writeFileSync(path.join(root, 'scripts/guard-todo-decomposition.mjs'), [
    "import fs from 'node:fs';",
    `const counterPath = ${JSON.stringify(guardCounterPath)};`,
    'export function validateTodoDecomposition() {',
    "  const attempt = Number.parseInt(fs.existsSync(counterPath) ? fs.readFileSync(counterPath, 'utf8') : '0', 10) + 1;",
    "  fs.writeFileSync(counterPath, String(attempt));",
    "  return attempt === 1 ? ['guard-todo-decomposition.mjs: TODO dependencies must not contain cycles'] : ['guard-todo-decomposition.mjs: terminal fixture failure'];",
    '}'
  ].join('\n'));

  const failed = runRecovery(root, diagnostic, '2', 'HEAD');
  assert.equal(failed.status, 1, `${failed.stdout}\n${failed.stderr}`);
  assert.equal(fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'), placeholder);
  const { record } = recoveryRecord(root);
  assert.equal(record.status, 'failed_reverted');
  assert.equal(record.placeholder_target_restorations[0].state, 'rolled_back');
  assert.equal(record.failure_reason, 'guard_remained_non_reparable');
});

test('wires recovery into pre-claim boundary and pre-completion failures, deferring completion after a Create-only replan', () => {
  const controller = fs.readFileSync(path.join(repositoryRoot, 'phase-loop.sh'), 'utf8');
  assert.match(controller, /stage.*pre-claim[\s\S]{0,500}phase-loop-preclaim-recovery\.mjs/u);
  assert.match(controller, /stage.*pre-claim-boundary/u);
  assert.match(controller, /stage.*pre-completion[\s\S]{0,900}precompletion_create_only_replan_applied/u);
  assert(controller.includes('--max-retries "$PHASE_LOOP_PRECLAIM_RECOVERY_MAX_RETRIES"'));
  assert(controller.includes('PHASE_LOOP_PRECLAIM_RECOVERY_ACTIVE:-0'));
  assert(controller.includes('PHASE_LOOP_PRECOMPLETION_REPLAN_APPLIED'));
  assert(controller.includes('--baseline-ref "$PHASE_LOOP_APPROVED_CONTROLLER_BASELINE"'));
  assert(controller.includes('precompletion_create_only_replan_deferred_completion=true'));
  assert(controller.includes('create_only_target_materialized_before_semantic_completion'));
  assert(controller.includes('preclaim_recovery_diagnostic_fallback=true'));
  assert(controller.includes('preclaim_recovery_preflight_diagnostic_replay=true'));
  assert(controller.includes('node "$ROOT_DIR/scripts/guard-todo-decomposition.mjs"'));
  assert(controller.includes('recovery_diagnostic="guard-todo-decomposition.mjs: $recovery_diagnostic"'));
  assert.match(controller, /\$\{snapshot_args\[@\]\+"\$\{snapshot_args\[@\]\}"\} 2>&1/u);
  assert.doesNotMatch(controller, /\$\{snapshot_args\[@\]\+"\$\{snapshot_args\[@\]\}"\}\n\s+2>&1/u);
});
