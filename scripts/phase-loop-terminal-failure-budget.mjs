import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = /^[0-9a-f]{64}$/u;
const gitObject = /^[0-9a-f]{40}$/u;

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function terminalFailureTrajectoryKey({
  objectiveSha256, workspaceCommit, failureClass, modePackVersion = null,
}) {
  if (!nonempty(objectiveSha256) || !sha256.test(objectiveSha256) ||
      !nonempty(workspaceCommit) || !gitObject.test(workspaceCommit) ||
      !nonempty(failureClass) || (modePackVersion !== null && !nonempty(modePackVersion))) {
    throw new Error('Invalid terminal failure trajectory identity');
  }

  return createHash('sha256')
    .update(JSON.stringify([objectiveSha256, workspaceCommit, failureClass, modePackVersion]))
    .digest('hex');
}

function requireRetryCap(cap) {
  if (!Number.isSafeInteger(cap) || cap < 0) {
    throw new Error('Invalid terminal failure retry cap');
  }
}

export function terminalFailureBudget(records, subject, configuredCap) {
  requireRetryCap(configuredCap);
  const trajectory = terminalFailureTrajectoryKey(subject);
  const attempts = new Map();
  let cap = configuredCap;
  for (const record of records) {
    if (record?.trajectory !== trajectory) continue;
    if (!nonempty(record.attemptId)) throw new Error('Missing terminal failure attempt identity');
    requireRetryCap(record.retryCap);
    if (attempts.has(record.attemptId) && attempts.get(record.attemptId) !== record.retryCap) {
      throw new Error('Conflicting terminal failure attempt replay');
    }
    attempts.set(record.attemptId, record.retryCap);
    cap = Math.min(cap, record.retryCap);
  }
  // The initial execution is recorded before any retry budget is spent.
  return { trajectory, attempts: attempts.size, cap, exhausted: attempts.size > cap };
}

export function persistedTerminalFailureBudgets(records, {
  objectiveSha256, workspaceCommit, modePackVersion, providerFailureFingerprint, todoFirstLine,
}) {
  const groups = new Map();
  for (const record of records) {
    const historicalFirstLine = typeof record.selected_todo_first_line === 'string'
      ? record.selected_todo_first_line.trim() : '';
    const matchesObjective = record.selected_todo_sha256
      ? record.selected_todo_sha256 === objectiveSha256
      : Boolean(todoFirstLine && historicalFirstLine === todoFirstLine);
    if (!matchesObjective) continue;
    if (!record.retry_trajectory) {
      if (workspaceCommit !== undefined) {
        return [{ exhausted: true, cap: 0, reason: 'terminal_failure_legacy_provenance_missing' }];
      }
      continue;
    }
    const { key, subject, attemptId } = record.retry_trajectory;
    if (subject?.objectiveSha256 !== objectiveSha256 || terminalFailureTrajectoryKey(subject) !== key) {
      throw new Error('Invalid persisted terminal failure trajectory');
    }
    if ((workspaceCommit && subject.workspaceCommit !== workspaceCommit) ||
        (modePackVersion !== undefined && subject.modePackVersion !== modePackVersion) ||
        (record.block_reason === 'terminal_runtime_failure' && providerFailureFingerprint &&
          record.provider_failure_fingerprint !== providerFailureFingerprint)) continue;
    if (!groups.has(key)) groups.set(key, { subject, rows: [] });
    groups.get(key).rows.push({ trajectory: key, attemptId, retryCap: record.retry_cap });
  }
  return [...groups.values()].map(({ subject, rows }) =>
    terminalFailureBudget(rows, subject, Number.MAX_SAFE_INTEGER));
}

export function readBlockedClaimRecords(filename) {
  let text;
  try {
    text = fs.readFileSync(filename, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return text.split('\n').flatMap((line, index) => {
    if (!line.trim()) return [];
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`Malformed blocked claim ledger at line ${index + 1}`);
    }
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error(`Invalid blocked claim ledger record at line ${index + 1}`);
    }
    return [record];
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [blockedPath, workspaceCommit, mode, source, progressPath] = process.argv.slice(2);
  try {
    if (mode === 'record-no-progress') {
      const claim = JSON.parse(fs.readFileSync(source, 'utf8'));
      const [runId, failureClass, capText] = process.argv.slice(7);
      const retryCap = Number(capText);
      if (!nonempty(claim.selected_todo) || !nonempty(claim.claim_id) ||
          !nonempty(runId) || !/^no_progress:[a-z0-9_:-]+$/u.test(failureClass) ||
          !/^[0-9]+$/u.test(capText)) throw new Error('Invalid no-progress attempt');
      requireRetryCap(retryCap);
      const subject = {
        objectiveSha256: createHash('sha256').update(claim.selected_todo).digest('hex'),
        workspaceCommit: claim.baseline_commit || workspaceCommit,
        failureClass,
        modePackVersion: claim.mode_pack_version ?? null,
      };
      const key = terminalFailureTrajectoryKey(subject);
      const attemptId = createHash('sha256').update(JSON.stringify([claim.claim_id, runId])).digest('hex');
      const record = {
        block_reason: 'controller_no_progress', selected_todo_sha256: subject.objectiveSha256,
        claim_id: claim.claim_id, run_stamp: runId, retry_cap: retryCap,
        retry_trajectory: { key, subject, attemptId },
      };
      const fd = fs.openSync(blockedPath, 'a', 0o600);
      try {
        fs.appendFileSync(fd, JSON.stringify(record) + '\n');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      process.exit(0);
    }
    const claim = mode === 'claim' ? JSON.parse(fs.readFileSync(source, 'utf8')) : null;
    const todo = claim ? claim.selected_todo : source;
    let progress;
    if (progressPath && fs.existsSync(progressPath)) {
      progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    }
    const records = readBlockedClaimRecords(blockedPath).filter(record =>
      ['terminal_runtime_failure', 'controller_no_progress'].includes(record.block_reason));
    const budgets = persistedTerminalFailureBudgets(records, {
      objectiveSha256: createHash('sha256').update(todo).digest('hex'),
      todoFirstLine: todo.split('\n')[0].trim(),
      workspaceCommit: claim?.baseline_commit || workspaceCommit,
      modePackVersion: claim?.mode_pack_version,
      providerFailureFingerprint: progress?.progress_projection?.provider_failure_fingerprint,
    });
    process.exitCode = budgets.length === 0 ? 1 : budgets.some((budget) => budget.exhausted) ? 2 : 0;
  } catch (error) {
    process.stderr.write(`Terminal retry evidence refused: ${error.message}\n`);
    process.exitCode = 2;
  }
}
