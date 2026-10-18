import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = path.resolve(new URL('..', import.meta.url).pathname);
const recoveryScript = path.join(repositoryRoot, 'scripts/phase-loop-preclaim-recovery.mjs');

function makeFixture({ repairableCycle = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-preclaim-recovery-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-claims'), { recursive: true });
  fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-replans'), { recursive: true });
  for (const file of ['guard-todo-decomposition.mjs', 'phase-loop-todo-state.mjs', 'repair-todo-decomposition.mjs']) {
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
    + '  Completion condition: create the fixture.\n'
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

function runRecovery(root, diagnostic, maxRetries = '3') {
  return spawnSync(process.execPath, [
    recoveryScript,
    '--repo', root,
    '--todo', '.brownie/todo.md',
    '--breakdown', '.brownie/todo-breakdown.md',
    '--claim', '.brownie/private/phase-loop/todo-claims/current.json',
    '--state-dir', path.join(root, '.brownie/private/phase-loop'),
    '--run-stamp', 'fixture-run',
    '--max-retries', maxRetries,
    '--diagnostic', diagnostic
  ], { cwd: repositoryRoot, encoding: 'utf8' });
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
  assert.equal(record.target_snapshot.length, 1);
  assert.equal(record.target_snapshot[0].path, 'scripts/a.mjs');
  assert.equal(record.target_snapshot[0].exists_before, false);
  assert.notEqual(record.before.todo_sha256, record.after.todo_sha256);
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

test('wires recovery only into the pre-claim failure path with an active-run recursion guard', () => {
  const controller = fs.readFileSync(path.join(repositoryRoot, 'phase-loop.sh'), 'utf8');
  assert.match(controller, /stage.*pre-claim[\s\S]{0,500}phase-loop-preclaim-recovery\.mjs/u);
  assert(controller.includes('--max-retries "$PHASE_LOOP_PRECLAIM_RECOVERY_MAX_RETRIES"'));
  assert(controller.includes('PHASE_LOOP_PRECLAIM_RECOVERY_ACTIVE:-0'));
});
