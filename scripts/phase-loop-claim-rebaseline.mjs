#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function argsFrom(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith('--')) args.set(argv[index].slice(2), argv[index + 1]);
  }
  return args;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function git(repo, args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function gitShow(repo, ref, relativePath) {
  try {
    return execFileSync('git', ['-C', repo, 'show', '--format=', `${ref}:${relativePath}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

function controllerSourceSnapshot(repo, baselineRef) {
  const manifest = readJson(path.join(repo, 'scripts/phase-loop-controller-source-manifest.json')) ?? {};
  const sourcePaths = Array.isArray(manifest.controller_source_paths) ? manifest.controller_source_paths : [];
  const files = [
    'scripts/phase-loop-controller-source-manifest.json',
    ...sourcePaths
  ].map((relativePath) => {
    let current = null;
    try { current = fs.readFileSync(path.join(repo, relativePath)); } catch { /* evidence records the absence */ }
    const baseline = gitShow(repo, baselineRef, relativePath);
    return {
      relative_path: relativePath,
      current_sha256: current ? sha256(current) : null,
      baseline_sha256: baseline ? sha256(Buffer.from(baseline, 'utf8')) : null,
      matches: Boolean(current && baseline && sha256(current) === sha256(Buffer.from(baseline, 'utf8'))),
    };
  });
  return {
    baseline_ref: baselineRef,
    baseline_commit: git(repo, ['rev-parse', '--verify', `${baselineRef}^{commit}`]) || null,
    current_head: git(repo, ['rev-parse', 'HEAD']) || null,
    source_fingerprint: `sha256:${sha256(JSON.stringify(files.map((file) => [file.relative_path, file.current_sha256])))}`,
    files,
  };
}

function selectedTodoId(selectedTodo) {
  return String(selectedTodo ?? '').split('\n')[0].match(/^\s*(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+([^:\s]+)/u)?.[1] ?? '';
}

function selectedContract(selectedTodo) {
  const text = String(selectedTodo ?? '');
  const targetText = text.match(/\b(?:Patch|Create) only\s+([^\n]*)/u)?.[1] ?? '';
  return {
    target_files: [...targetText.matchAll(/`([^`]+)`/gu)].map((match) => match[1]).filter((value) => /[/.]/u.test(value)),
    verification_commands: [...text.matchAll(/^\s*Verification:\s*run\s+`([^`]+)`/gmu)].map((match) => match[1]),
  };
}

function flattenLedger(value) {
  if (value?.kind === 'terminal_failure_transaction' || value?.kind === 'replan_transaction') {
    return Array.isArray(value.events) ? value.events : [];
  }
  return value ? [value] : [];
}

function readLedger(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      try { return flattenLedger(JSON.parse(line)); } catch { return []; }
    });
  } catch { return []; }
}

function priorTerminalEvidence(runsDir, claimId) {
  if (!runsDir || !fs.existsSync(runsDir)) return [];
  const matches = [];
  for (const name of fs.readdirSync(runsDir)) {
    if (!name.endsWith('.stdout.log')) continue;
    const file = path.join(runsDir, name);
    const payload = readJson(file);
    const root = payload?.run ?? payload?.resume ?? payload;
    const automation = root?.automation ?? {};
    if ((root?.phase_loop_claim_id ?? '') !== claimId) continue;
    if (root?.terminal_failure === true || automation.terminal_failure === true || root?.stop_class === 'terminal_failure' || automation.stop_class === 'terminal_failure') {
      matches.push(file);
    }
  }
  return matches.sort();
}

function archivePath(claimDir, runStamp) {
  let candidate = path.join(claimDir, `stale-rebaseline-${runStamp}.json`);
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(claimDir, `stale-rebaseline-${runStamp}-${suffix}.json`);
    suffix += 1;
  }
  return candidate;
}

export function rebaselineStaleClaim({
  repo,
  stateDir,
  claimPath,
  statusPath,
  progressPath,
  queuePath,
  ledgerPath,
  runsDir,
  todoPath,
  runStamp,
  baselineRef = 'origin/main',
}) {
  const claim = readJson(claimPath);
  const status = readJson(statusPath) ?? {};
  const progress = readJson(progressPath) ?? {};
  const queue = readJson(queuePath) ?? {};
  if (!claim || !['claimed', 'in_progress', 'running'].includes(claim.status)) {
    return { ok: true, rebaselined: false, reason: 'no_active_claim' };
  }
  if (claim.terminal_failure_recovery_pending === true || claim.terminal_failure_source_transition_pending === true) {
    return { ok: true, rebaselined: false, reason: 'durable_recovery_pending', claim_id: claim.claim_id };
  }
  const projection = progress.progress_projection && typeof progress.progress_projection === 'object'
    ? progress.progress_projection : {};
  const claimMatchesProjection = projection.claim_id === claim.claim_id;
  const terminalProjection = claimMatchesProjection && (
    progress.classification === 'terminal_failure'
    || projection.stop_class === 'terminal_failure'
    || projection.stop_reason === 'terminal_task_failed'
    || projection.cli_status === 'no_eligible_task'
    || projection.closure === 'no_eligible_task'
  );
  const queueMismatch = (
    claim.queue_generation != null && queue.generation != null && String(claim.queue_generation) !== String(queue.generation)
  ) || (
    claim.queue_fingerprint && queue.fingerprint && claim.queue_fingerprint !== queue.fingerprint
  );
  const ledgerEvidence = readLedger(ledgerPath).filter((event) => event.claim_id === claim.claim_id && ['failed', 'blocked', 'replanned', 'completed'].includes(event.to_state));
  const priorRuns = priorTerminalEvidence(runsDir, claim.claim_id);
  const staleRun = claim.run_stamp && claim.run_stamp !== runStamp;
  // A non-running persisted status is the controller's durable indication
  // that the previous owner is no longer active.  Do not trust a stale PID
  // left in the status file: the run-once entrypoint has already performed
  // the live-owner check before reaching this recovery guard.
  const ownerStopped = status.status !== 'running';
  const shouldRebaseline = staleRun && ownerStopped && (queueMismatch || terminalProjection || ledgerEvidence.length > 0 || priorRuns.length > 0);
  if (!shouldRebaseline) {
    return {
      ok: true,
      rebaselined: false,
      reason: 'claim_is_current_or_no_terminal_staleness',
      claim_id: claim.claim_id,
      queue_mismatch: queueMismatch,
      terminal_projection: terminalProjection,
      ledger_terminal_events: ledgerEvidence.length,
      prior_terminal_runs: priorRuns.length,
    };
  }

  const selected = String(claim.selected_todo ?? '');
  const contract = selectedContract(selected);
  const source = controllerSourceSnapshot(repo, baselineRef);
  const audit = {
    schema_version: 1,
    kind: 'phase_loop_claim_rebaseline',
    rebaseline_id: `rebaseline-${runStamp}-${sha256(String(claim.claim_id)).slice(0, 12)}`,
    run_stamp: runStamp,
    recorded_at: new Date().toISOString(),
    source,
    queue: {
      path: queuePath,
      generation: queue.generation ?? null,
      fingerprint: queue.fingerprint ?? null,
    },
    selected_todo_id: selectedTodoId(selected),
    selected_todo_sha256: sha256(selected),
    target_files: contract.target_files,
    verification_commands: contract.verification_commands,
    source_claim: {
      claim_id: claim.claim_id ?? null,
      status: claim.status,
      run_stamp: claim.run_stamp ?? null,
      queue_generation: claim.queue_generation ?? null,
      queue_fingerprint: claim.queue_fingerprint ?? null,
      retry_cap: claim.retry_cap ?? null,
    },
    reasons: {
      stale_run: staleRun,
      owner_stopped: ownerStopped,
      queue_mismatch: queueMismatch,
      terminal_projection: terminalProjection,
      ledger_terminal_events: ledgerEvidence,
      prior_terminal_runs: priorRuns,
    },
    recovery_state: 'redelegatable',
    retry_policy: 'do_not_inherit_source_claim_retry_cap_or_terminal_state',
  };
  const claimDir = path.dirname(claimPath);
  const auditPath = path.join(claimDir, `${audit.rebaseline_id}.json`);
  const stalePath = archivePath(claimDir, runStamp);
  const archived = {
    ...claim,
    status: 'stale_snapshot_rejected',
    archive_reason: 'stale_claim_rebaseline',
    recovery_state: 'redelegatable',
    retry_eligible: true,
    rebaseline_id: audit.rebaseline_id,
    rebaseline_audit: path.relative(stateDir, auditPath),
    rebaselined_at: audit.recorded_at,
    status_history: [...(Array.isArray(claim.status_history) ? claim.status_history : []), {
      status: 'stale_snapshot_rejected',
      run_stamp: runStamp,
      updated_at: audit.recorded_at,
      note: 'stale_claim_isolated_before_new_run',
    }],
  };
  writeJson(auditPath, audit);
  writeJson(stalePath, archived);
  fs.unlinkSync(claimPath);
  return {
    ok: true,
    rebaselined: true,
    reason: 'stale_claim_isolated_before_new_run',
    rebaseline_id: audit.rebaseline_id,
    audit_path: auditPath,
    stale_claim_path: stalePath,
    source_claim_id: claim.claim_id,
    selected_todo_id: selectedTodoId(selected),
    queue_generation: queue.generation ?? null,
    queue_fingerprint: queue.fingerprint ?? null,
    recovery_state: audit.recovery_state,
  };
}

function payloadFromFile(file) {
  const root = readJson(file);
  const payload = root?.run ?? root?.resume ?? root;
  return { root, payload: payload && typeof payload === 'object' ? payload : {} };
}

export function writeTerminalExecutionEvidence({
  stdoutPath,
  claimSnapshotPath,
  outputPath,
  runStamp,
  workspaceBefore = '',
  workspaceAfter = '',
}) {
  const snapshot = readJson(claimSnapshotPath) ?? {};
  const claim = snapshot.claim ?? snapshot;
  const { root, payload } = payloadFromFile(stdoutPath);
  const automation = payload.automation && typeof payload.automation === 'object' ? payload.automation : {};
  const contract = selectedContract(claim.selected_todo);
  const execution = payload.task_execution && typeof payload.task_execution === 'object' ? payload.task_execution : {};
  const explicitSignals = [
    execution.started === true,
    payload.objective_apply_applied === true,
    ['applied', 'started', 'attempted'].includes(String(payload.objective_apply_status ?? '').toLowerCase()),
    payload.workspace_write_applied === true,
    payload.verification && typeof payload.verification === 'object',
    Array.isArray(payload.verification_results),
    typeof payload.verification_output === 'string' && payload.verification_output.trim().length > 0,
    workspaceBefore !== workspaceAfter && workspaceBefore !== '' && workspaceAfter !== '',
  ];
  const runtimeClaimId = payload.phase_loop_claim_id ?? automation.phase_loop_claim_id ?? null;
  const claimMatches = !runtimeClaimId || runtimeClaimId === claim.claim_id;
  const evidence = {
    schema_version: 1,
    kind: 'phase_loop_terminal_failure_execution_evidence',
    run_stamp: runStamp,
    runtime_run_id: payload.run_id ?? automation.run_id ?? payload.session_id ?? automation.session_id ?? null,
    claim_id: claim.claim_id ?? null,
    runtime_claim_id: runtimeClaimId,
    claim_matches: claimMatches,
    task_id: payload.task_id ?? automation.task_id ?? null,
    selected_todo_id: selectedTodoId(claim.selected_todo),
    selected_todo_sha256: sha256(String(claim.selected_todo ?? '')),
    target_files: contract.target_files,
    verification_commands: contract.verification_commands,
    signals: {
      explicit: explicitSignals,
      task_execution: execution,
      payload_status: payload.status ?? null,
      stop_class: payload.stop_class ?? automation.stop_class ?? null,
      stop_reason: payload.stop_reason ?? automation.stop_reason ?? null,
    },
    task_execution_confirmed: claimMatches && explicitSignals.some(Boolean),
    source: 'current_run_stdout_and_claim_snapshot',
    stdout_path: stdoutPath,
  };
  writeJson(outputPath, evidence);
  return evidence;
}

function main() {
  const command = process.argv[2];
  const args = argsFrom(process.argv.slice(3));
  if (command === 'rebaseline') {
    const result = rebaselineStaleClaim({
      repo: path.resolve(args.get('repo')),
      stateDir: path.resolve(args.get('state-dir')),
      claimPath: path.resolve(args.get('claim')),
      statusPath: path.resolve(args.get('status')),
      progressPath: path.resolve(args.get('progress')),
      queuePath: path.resolve(args.get('queue')),
      ledgerPath: path.resolve(args.get('ledger')),
      runsDir: path.resolve(args.get('runs')),
      todoPath: path.resolve(args.get('todo')),
      runStamp: args.get('run-stamp'),
      baselineRef: args.get('baseline-ref') ?? 'origin/main',
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(result.ok ? 0 : 78);
  }
  if (command === 'terminal-evidence') {
    const result = writeTerminalExecutionEvidence({
      stdoutPath: path.resolve(args.get('stdout')),
      claimSnapshotPath: path.resolve(args.get('claim-snapshot')),
      outputPath: path.resolve(args.get('output')),
      runStamp: args.get('run-stamp'),
      workspaceBefore: args.get('workspace-before') ?? '',
      workspaceAfter: args.get('workspace-after') ?? '',
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(result.task_execution_confirmed ? 0 : 1);
  }
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
