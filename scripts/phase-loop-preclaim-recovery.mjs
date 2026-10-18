#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(new URL('..', import.meta.url).pathname);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    args[value.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256Text(value) {
  return sha256Buffer(Buffer.from(value, 'utf8'));
}

function sha256File(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    ? sha256Buffer(fs.readFileSync(filePath))
    : null;
}

function atomicWrite(filePath, content) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function writeJson(filePath, value) {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
  fs.chmodSync(filePath, 0o600);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function isReparableDecompositionDiagnostic(diagnostic) {
  const text = String(diagnostic ?? '');
  if (!text.includes('guard-todo-decomposition.mjs') && !text.includes('phase-loop-todo-queue-integrity.mjs')) {
    return false;
  }
  return /Create only target already exists|TODO dependencies must not contain cycles|dependency .* present only in the breakdown ledger|abstract\/decomposed parent|superseded parent|dangling dependency|todo-replan/iu.test(text);
}

function todoBlocks(todoText) {
  const starts = [...todoText.matchAll(/^(?:[-*]|\d+[.)])\s+\[\s\]\s+/gmu)].map((match) => match.index);
  return starts.map((start, index) => todoText.slice(start, starts[index + 1] ?? todoText.length).trim());
}

function restoreSnapshot({ recoveryDir, todoPath, breakdownPath, breakdownExisted }) {
  fs.copyFileSync(path.join(recoveryDir, 'todo.before.md'), todoPath);
  const breakdownSnapshot = path.join(recoveryDir, 'todo-breakdown.before.md');
  if (breakdownExisted) {
    fs.copyFileSync(breakdownSnapshot, breakdownPath);
  } else if (fs.existsSync(breakdownPath)) {
    fs.unlinkSync(breakdownPath);
  }
}

const terminalRecoveryStatuses = new Set([
  'applied',
  'failed_reverted',
  'failed_recovery_snapshot_missing',
  'failed_recovery_record_invalid'
]);

function findInterruptedRecovery({ stateDir, todoPath, breakdownPath, diagnostic }) {
  const recoveryRoot = path.join(stateDir, 'preclaim-recovery');
  if (!fs.existsSync(recoveryRoot)) return null;
  const matches = fs.readdirSync(recoveryRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const recoveryDir = path.join(recoveryRoot, entry.name);
      const recordPath = path.join(recoveryDir, 'record.json');
      if (!fs.existsSync(recordPath)) return null;
      const record = readJson(recordPath);
      return record.status === 'started'
        && record.before?.todo_path === todoPath
        && record.before?.breakdown_path === breakdownPath
        && record.diagnostic_tail === diagnostic.slice(-6000)
        ? { recoveryDir, recordPath, record }
        : null;
    })
    .filter(Boolean);
  if (matches.length > 1) {
    throw new Error('multiple interrupted pre-claim recovery records match the current event');
  }
  return matches[0] ?? null;
}

function recoverySnapshotMissing({ record }) {
  const required = [
    record.rollback_snapshot?.todo,
    record.claim_snapshot?.recovery_claim_path
  ];
  if (record.rollback_snapshot?.breakdown) required.push(record.rollback_snapshot.breakdown);
  return required.filter((filePath) => typeof filePath !== 'string' || !fs.existsSync(filePath));
}

function markRecoveryTerminal({ recordPath, record, status, reason, missing = [] }) {
  record.status = status;
  record.failure_reason = reason;
  record.snapshot_missing = missing;
  record.terminal_recorded_at = new Date().toISOString();
  writeJson(recordPath, record);
}

async function main(rawArgs) {
  const args = rawArgs;
  const repo = path.resolve(args.repo ?? repositoryRoot);
  const todoPath = path.resolve(repo, args.todo ?? '.brownie/todo.md');
  const breakdownPath = path.resolve(repo, args.breakdown ?? '.brownie/todo-breakdown.md');
  const claimPath = path.resolve(repo, args.claim ?? '.brownie/private/phase-loop/todo-claims/current.json');
  const stateDir = path.resolve(args['state-dir'] ?? path.join(repo, '.brownie/private/phase-loop'));
  const diagnostic = String(args.diagnostic ?? '');
  const runStamp = String(args['run-stamp'] ?? new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z'));
  const maxRetriesRaw = Number.parseInt(args['max-retries'] ?? '3', 10);
  const maxRetries = Number.isInteger(maxRetriesRaw) && maxRetriesRaw > 0 ? maxRetriesRaw : 3;

  if (!isReparableDecompositionDiagnostic(diagnostic)) {
    return 2;
  }
  if (!fs.existsSync(todoPath)) {
    return 1;
  }

  const todoBeforeText = fs.readFileSync(todoPath, 'utf8');
  const breakdownBeforeExists = fs.existsSync(breakdownPath);
  const breakdownBeforeText = breakdownBeforeExists ? fs.readFileSync(breakdownPath, 'utf8') : '';
  const claim = readJson(claimPath);
  let selectedTodo = typeof claim.selected_todo === 'string' && todoBeforeText.includes(claim.selected_todo)
    ? claim.selected_todo
    : todoBlocks(todoBeforeText)[0] ?? '';
  const todoBeforeHash = sha256Text(todoBeforeText);
  const breakdownBeforeHash = breakdownBeforeExists ? sha256Text(breakdownBeforeText) : null;
  const eventKey = sha256Text(`${todoBeforeHash}\n${breakdownBeforeHash ?? 'missing'}\n${diagnostic}`);
  let recoveryDir = path.join(stateDir, 'preclaim-recovery', eventKey);
  let recordPath = path.join(recoveryDir, 'record.json');
  let recoveryRecord = fs.existsSync(recordPath) ? readJson(recordPath) : null;
  if (!recoveryRecord) {
    const interrupted = findInterruptedRecovery({ stateDir, todoPath, breakdownPath, diagnostic });
    if (interrupted) {
      recoveryDir = interrupted.recoveryDir;
      recordPath = interrupted.recordPath;
      recoveryRecord = interrupted.record;
    }
  }
  if (recoveryRecord) {
    if (recoveryRecord.status !== 'started') {
      return terminalRecoveryStatuses.has(recoveryRecord.status) ? 2 : 1;
    }
    const missingSnapshots = recoverySnapshotMissing({ record: recoveryRecord });
    if (missingSnapshots.length > 0) {
      markRecoveryTerminal({
        recordPath,
        record: recoveryRecord,
        status: 'failed_recovery_snapshot_missing',
        reason: 'recovery_snapshot_missing',
        missing: missingSnapshots
      });
      return 1;
    }
    try {
      restoreSnapshot({
        recoveryDir,
        todoPath,
        breakdownPath,
        breakdownExisted: Boolean(recoveryRecord.rollback_snapshot.breakdown)
      });
    } catch (error) {
      markRecoveryTerminal({
        recordPath,
        record: recoveryRecord,
        status: 'failed_recovery_snapshot_missing',
        reason: 'recovery_snapshot_restore_failed',
        missing: [String(error?.message ?? error)]
      });
      return 1;
    }
    recoveryRecord.recovery_resumes = [
      ...(Array.isArray(recoveryRecord.recovery_resumes) ? recoveryRecord.recovery_resumes : []),
      {
        run_stamp: runStamp,
        resumed_at: new Date().toISOString(),
        rollback_performed: true
      }
    ];
    recoveryRecord.resumed_after_interruption = true;
    writeJson(recordPath, recoveryRecord);
  }

  if (!recoveryRecord) {
    fs.mkdirSync(recoveryDir, { recursive: true, mode: 0o700 });
    fs.copyFileSync(todoPath, path.join(recoveryDir, 'todo.before.md'));
    fs.chmodSync(path.join(recoveryDir, 'todo.before.md'), 0o600);
    if (breakdownBeforeExists) {
      fs.copyFileSync(breakdownPath, path.join(recoveryDir, 'todo-breakdown.before.md'));
      fs.chmodSync(path.join(recoveryDir, 'todo-breakdown.before.md'), 0o600);
    }
  }

  const recoveryClaimPath = recoveryRecord?.claim_snapshot?.recovery_claim_path ?? path.join(recoveryDir, 'claim.json');
  if (!recoveryRecord) {
    const recoveryClaim = {
      schema_version: 1,
      claim_id: String(claim.claim_id ?? `preclaim-recovery-${eventKey.slice(0, 16)}`),
      status: 'preclaim_recovery',
      selected_todo: selectedTodo,
      queue_fingerprint: String(claim.queue_fingerprint ?? ''),
      source_claim_path: claimPath,
      event_key: eventKey
    };
    writeJson(recoveryClaimPath, recoveryClaim);
    atomicWrite(path.join(recoveryDir, 'selected-todo.before.md'), selectedTodo ? `${selectedTodo}\n` : '');
  }

  const firstLine = recoveryRecord?.claim_snapshot?.selected_todo_first_line ?? selectedTodo.split('\n')[0] ?? '';
  const targetSnapshot = recoveryRecord?.target_snapshot ?? [...firstLine.matchAll(/\b(Patch|Create) only\s+`([^`]+)`/gu)].map((match) => {
    const targetPath = path.resolve(repo, match[2]);
    return {
      operation: match[1],
      path: match[2],
      exists_before: fs.existsSync(targetPath),
      sha256_before: sha256File(targetPath)
    };
  });
  const record = recoveryRecord ?? {
    schema_version: 1,
    record_type: 'phase_loop_preclaim_recovery',
    status: 'started',
    reason: 'reparable_decomposition_diagnostics_before_claim',
    event_key: eventKey,
    run_stamp: runStamp,
    max_retries: maxRetries,
    diagnostic_tail: diagnostic.slice(-6000),
    claim_snapshot: {
      source_path: claimPath,
      claim_id: String(claim.claim_id ?? ''),
      selected_todo_first_line: firstLine,
      selected_todo_sha256: sha256Text(selectedTodo),
      recovery_claim_path: recoveryClaimPath
    },
    target_snapshot: targetSnapshot,
    before: {
      todo_path: todoPath,
      todo_sha256: todoBeforeHash,
      breakdown_path: breakdownPath,
      breakdown_sha256: breakdownBeforeHash
    },
    rollback_snapshot: {
      todo: path.join(recoveryDir, 'todo.before.md'),
      breakdown: breakdownBeforeExists ? path.join(recoveryDir, 'todo-breakdown.before.md') : null,
      selected_todo: path.join(recoveryDir, 'selected-todo.before.md')
    },
    attempts: []
  };
  writeJson(recordPath, record);

  const repairScript = path.join(repo, 'scripts/repair-todo-decomposition.mjs');
  const guardScript = path.join(repo, 'scripts/guard-todo-decomposition.mjs');
  process.env.BROWNIE_REPAIR_TODO_REPO_ROOT = repo;
  const { repairTodoDecomposition } = await import(pathToFileURL(repairScript).href);
  const { validateTodoDecomposition } = await import(pathToFileURL(guardScript).href);

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    let repair;
    try {
      const repairResult = repairTodoDecomposition({
        claimPath: recoveryClaimPath,
        todoPath,
        breakdownPath,
        runStamp: `${runStamp}-preclaim-${attempt}`
      });
      repair = {
        exitCode: repairResult.applied ? 0 : repairResult.eligible ? 1 : 2,
        output: JSON.stringify(repairResult)
      };
    } catch (error) {
      repair = { exitCode: 1, output: String(error?.stack ?? error) };
    }
    const guardErrors = validateTodoDecomposition(repo, path.relative(repo, todoPath));
    const guard = {
      exitCode: guardErrors.length > 0 ? 1 : 0,
      output: guardErrors.length > 0 ? `TODO decomposition guard failed:\n${guardErrors.map((error) => `- ${error}`).join('\n')}` : 'TODO decomposition guard passed.'
    };
    const currentRecord = readJson(recordPath);
    currentRecord.attempts.push({
      attempt,
      repair_exit: repair.exitCode,
      repair_output_tail: repair.output.slice(-4000),
      guard_exit: guard.exitCode,
      guard_output_tail: guard.output.slice(-4000),
      todo_sha256_after: sha256File(todoPath),
      breakdown_sha256_after: sha256File(breakdownPath)
    });
    currentRecord.after = {
      todo_sha256: sha256File(todoPath),
      breakdown_sha256: sha256File(breakdownPath)
    };
    currentRecord.target_snapshot = targetSnapshot.map((target) => {
      const targetPath = path.resolve(repo, target.path);
      return {
        ...target,
        exists_after: fs.existsSync(targetPath),
        sha256_after: sha256File(targetPath)
      };
    });
    writeJson(recordPath, currentRecord);

    if (guard.exitCode === 0) {
      currentRecord.status = 'applied';
      currentRecord.rollback_performed = false;
      writeJson(recordPath, currentRecord);
      return 0;
    }

    const canRetry = repair.exitCode === 0 && attempt < maxRetries && isReparableDecompositionDiagnostic(guard.output);
    if (canRetry) {
      continue;
    }

    restoreSnapshot({ recoveryDir, todoPath, breakdownPath, breakdownExisted: breakdownBeforeExists });
    currentRecord.status = 'failed_reverted';
    currentRecord.rollback_performed = true;
    currentRecord.failure_reason = repair.exitCode !== 0
      ? 'repair_command_failed'
      : !isReparableDecompositionDiagnostic(guard.output)
        ? 'guard_remained_non_reparable'
        : 'retry_bound_reached';
    currentRecord.after_rollback = {
      todo_sha256: sha256File(todoPath),
      breakdown_sha256: sha256File(breakdownPath),
      guard_output_tail: guard.output.slice(-4000)
    };
    writeJson(recordPath, currentRecord);
    return 1;
  }
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const args = parseArgs(process.argv.slice(2));
  main(args).then((status) => process.exit(status)).catch((error) => {
    console.error(error?.stack ?? error);
    process.exit(1);
  });
}

export { isReparableDecompositionDiagnostic, main };
