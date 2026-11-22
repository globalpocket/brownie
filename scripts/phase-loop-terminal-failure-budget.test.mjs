import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { terminalFailureBudget, terminalFailureTrajectoryKey } from './phase-loop-terminal-failure-budget.mjs';

const subject = {
  objectiveSha256: 'a'.repeat(64),
  workspaceCommit: 'b'.repeat(40),
  failureClass: 'provider_unavailable',
  modePackVersion: 'pack-1',
};

test('claim replacement cannot restart the trajectory retry budget', () => {
  const trajectory = terminalFailureTrajectoryKey(subject);
  const rows = [];
  for (let count = 1; count <= 12; count += 1) {
    rows.push({ trajectory, attemptId: `attempt-${count}`, retryCap: 1, claimId: `claim-${count}` });
    const { attempts, cap, exhausted } = terminalFailureBudget(rows, subject, 100);
    assert.deepEqual({ attempts, cap, exhausted }, { attempts: count, cap: 1, exhausted: count >= 2 });
  }
});

test('exact replays count once and conflicting replays fail closed', () => {
  const trajectory = terminalFailureTrajectoryKey(subject);
  const row = { trajectory, attemptId: 'initial', retryCap: 1 };
  assert.equal(terminalFailureBudget([row, { ...row }], subject, 1).attempts, 1);
  assert.throws(() => terminalFailureBudget([row, { ...row, retryCap: 4 }], subject, 1), /Conflicting/);
});

test('an actual workspace, objective, failure class or Mode Pack change has a separate budget', () => {
  const trajectory = terminalFailureTrajectoryKey(subject);
  const rows = [{ trajectory, attemptId: 'initial', retryCap: 0 }];
  for (const changed of [
    { objectiveSha256: 'c'.repeat(64) }, { workspaceCommit: 'd'.repeat(40) },
    { failureClass: 'invalid_configuration' }, { modePackVersion: 'pack-2' },
  ]) {
    assert.equal(terminalFailureBudget(rows, { ...subject, ...changed }, 0).attempts, 0);
  }
  assert.throws(() => terminalFailureTrajectoryKey({ ...subject, workspaceCommit: 'b'.repeat(64) }), /Invalid/);
});

test('separate supervisor readers retain an exhausted durable budget', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'brownie-terminal-budget-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const todo = '- [ ] fixture: update fixture.';
  const selected = {
    ...subject, objectiveSha256: createHash('sha256').update(todo).digest('hex'),
  };
  const key = terminalFailureTrajectoryKey(selected);
  const blocked = join(dir, 'blocked.jsonl');
  const claim = join(dir, 'claim.json');
  const cli = fileURLToPath(new URL('./phase-loop-terminal-failure-budget.mjs', import.meta.url));
  for (let index = 0; index < 12; index += 1) {
    writeFileSync(claim, JSON.stringify({
      claim_id: `claim-${index}`, selected_todo: todo,
      baseline_commit: selected.workspaceCommit, mode_pack_version: selected.modePackVersion,
    }));
    appendFileSync(blocked, JSON.stringify({
      block_reason: 'terminal_runtime_failure', selected_todo_sha256: selected.objectiveSha256,
      retry_cap: 1, retry_trajectory: { key, subject: selected, attemptId: `attempt-${index}` },
    }) + '\n');
    const result = spawnSync(process.execPath, [cli, blocked, selected.workspaceCommit, 'claim', claim], { encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, index === 0 ? 0 : 2, result.stderr);
  }
  assert.equal(spawnSync(process.execPath, [cli, blocked, 'd'.repeat(40), 'todo', todo]).status, 1);
});
