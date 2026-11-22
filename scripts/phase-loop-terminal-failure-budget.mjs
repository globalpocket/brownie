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
  objectiveSha256, workspaceCommit, modePackVersion, providerFailureFingerprint,
}) {
  const groups = new Map();
  for (const record of records) {
    if (record.selected_todo_sha256 !== objectiveSha256 || !record.retry_trajectory) continue;
    const { key, subject, attemptId } = record.retry_trajectory;
    if (subject?.objectiveSha256 !== objectiveSha256 || terminalFailureTrajectoryKey(subject) !== key) {
      throw new Error('Invalid persisted terminal failure trajectory');
    }
    if ((workspaceCommit && subject.workspaceCommit !== workspaceCommit) ||
        (modePackVersion !== undefined && subject.modePackVersion !== modePackVersion) ||
        (providerFailureFingerprint && record.provider_failure_fingerprint !== providerFailureFingerprint)) continue;
    if (!groups.has(key)) groups.set(key, { subject, rows: [] });
    groups.get(key).rows.push({ trajectory: key, attemptId, retryCap: record.retry_cap });
  }
  return [...groups.values()].map(({ subject, rows }) =>
    terminalFailureBudget(rows, subject, Number.MAX_SAFE_INTEGER));
}

function readTerminalRecords(filename) {
  return fs.readFileSync(filename, 'utf8').split('\n').flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const record = JSON.parse(line);
      return record?.block_reason === 'terminal_runtime_failure' ? [record] : [];
    } catch {
      return [];
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [blockedPath, workspaceCommit, mode, source, progressPath] = process.argv.slice(2);
  try {
    const claim = mode === 'claim' ? JSON.parse(fs.readFileSync(source, 'utf8')) : null;
    const todo = claim ? claim.selected_todo : source;
    let progress;
    if (progressPath && fs.existsSync(progressPath)) {
      progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    }
    const budgets = persistedTerminalFailureBudgets(readTerminalRecords(blockedPath), {
      objectiveSha256: createHash('sha256').update(todo).digest('hex'),
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
