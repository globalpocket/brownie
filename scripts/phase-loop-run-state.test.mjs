import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { allSupervisorProcessRecords, inspectSupervisorOwnership, migrateLegacyPhaseLoopState, normalizeStaleRunningStatus, quiesceLegacySupervisor, rollbackStaleRunningRecovery, terminateLegacySupervisor, watchdogContinuationLiveness } from './phase-loop-run-state.mjs';

function fixture() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-run-state-'));
  fs.mkdirSync(stateDir, { recursive: true });
  return { stateDir, statusPath: path.join(stateDir, 'status.json'), pidPath: path.join(stateDir, 'phase-loop.pid'), ownerPath: path.join(stateDir, 'phase-loop-owner.json') };
}

function writeOwner(ownerPath, pid = 1234, generation = 'generation-1') {
  fs.writeFileSync(ownerPath, JSON.stringify({ schema_version: 1, pid, generation, root_dir: '/repo' }));
}

test('normalizes a stale running status with an atomic replacement and two-phase audit', () => {
  const { stateDir, statusPath, pidPath } = fixture();
  const previous = {
    status: 'running',
    detail: 'interrupted by host loss',
    run_id: 'run-stale',
    exit_code: '',
    consecutive_failures: 2,
    pid_file: pidPath
  };
  fs.writeFileSync(statusPath, JSON.stringify(previous));
  fs.writeFileSync(pidPath, '999999');

  const result = normalizeStaleRunningStatus({
    stateDir,
    pidFile: pidPath,
    runStamp: 'next-run',
    now: '2026-10-18T01:02:03.000Z',
    processExists: () => false
  });
  assert.equal(result.ok, true);
  assert.equal(result.normalized, true);
  assert.equal(result.replacement_status.status, 'recovered_stale_running');
  assert.equal(result.replacement_status.exit_code, '78');
  assert.equal(result.replacement_status.consecutive_failures, 3);
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).recovery_id, result.recovery_id);
  const audit = fs.readFileSync(path.join(stateDir, 'run-state-recovery.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(audit.map((record) => record.phase), ['prepared', 'applied']);
  assert.deepEqual(audit[0].previous_status, previous);
  assert.equal(audit[1].replacement_status.status, 'recovered_stale_running');
});

test('refuses to normalize a status whose PID is still alive', () => {
  const { stateDir, statusPath, pidPath } = fixture();
  fs.writeFileSync(statusPath, JSON.stringify({ status: 'running', run_id: 'live-run', pid_file: pidPath, supervisor_pid: 1234, supervisor_generation: 'generation-1' }));
  fs.writeFileSync(pidPath, '1234');
  writeOwner(path.join(stateDir, 'phase-loop-owner.json'));
  const result = normalizeStaleRunningStatus({ stateDir, pidFile: pidPath, rootDir: '/repo', processExists: () => true, getProcessCommand: () => 'bash /repo/phase-loop.sh supervise', listSupervisors: () => [1234] });
  assert.deepEqual(result, { ok: false, code: 'run_already_running', pid: 1234, run_id: 'live-run' });
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).status, 'running');
  assert.equal(fs.existsSync(path.join(stateDir, 'run-state-recovery.jsonl')), false);
});

test('allows the owning supervisor to resume an authorized continuation', () => {
  const { stateDir, statusPath, pidPath } = fixture();
  fs.writeFileSync(statusPath, JSON.stringify({
    status: 'running',
    run_id: 'continuation-run',
    pid_file: pidPath,
    continuation_required: true,
    controller_action: 'resume',
    supervisor_pid: 1234,
    supervisor_generation: 'generation-1'
  }));
  fs.writeFileSync(pidPath, '1234');
  writeOwner(path.join(stateDir, 'phase-loop-owner.json'));
  const result = normalizeStaleRunningStatus({
    stateDir,
    pidFile: pidPath,
    rootDir: '/repo',
    ownerPid: 1234,
    processExists: () => true,
    getProcessCommand: () => 'bash /repo/phase-loop.sh supervise',
    listSupervisors: () => [1234]
  });
  assert.deepEqual(result, {
    ok: true,
    normalized: false,
    reason: 'owned_continuation_resume',
    pid: 1234,
    run_id: 'continuation-run',
    generation: 'generation-1'
  });
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).status, 'running');
  assert.equal(fs.existsSync(path.join(stateDir, 'run-state-recovery.jsonl')), false);
});

test('fails closed when a different live process owns the continuation state', () => {
  const { stateDir, statusPath, pidPath } = fixture();
  fs.writeFileSync(statusPath, JSON.stringify({
    status: 'running',
    run_id: 'competing-run',
    pid_file: pidPath,
    continuation_required: true,
    controller_action: 'resume'
  }));
  fs.writeFileSync(pidPath, '5678');
  fs.writeFileSync(path.join(stateDir, 'phase-loop-owner.json'), JSON.stringify({ schema_version: 1, pid: 5678, generation: 'generation-1', root_dir: '/repo' }));
  const result = normalizeStaleRunningStatus({
    stateDir,
    pidFile: pidPath,
    rootDir: '/repo',
    ownerPid: 1234,
    processExists: () => true,
    getProcessCommand: () => 'bash /repo/phase-loop.sh supervise',
    listSupervisors: () => [5678]
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'supervisor_ownership_conflict');
  assert.equal(result.pid, 5678);
  assert.equal(result.run_id, 'competing-run');
});

test('leaves non-running status untouched', () => {
  const { stateDir, statusPath } = fixture();
  fs.writeFileSync(statusPath, JSON.stringify({ status: 'last_run_failed', run_id: 'finished' }));
  const result = normalizeStaleRunningStatus({ stateDir, processExists: () => { throw new Error('must not inspect PID'); } });
  assert.equal(result.ok, true);
  assert.equal(result.normalized, false);
  assert.equal(result.reason, 'status_not_running');
});

test('supports guarded rollback of the latest recovery for audit and operator correction', () => {
  const { stateDir, statusPath, pidPath } = fixture();
  fs.writeFileSync(statusPath, JSON.stringify({ status: 'running', detail: 'previous', run_id: 'run-reversible', pid_file: pidPath }));
  const normalized = normalizeStaleRunningStatus({
    stateDir,
    pidFile: pidPath,
    now: '2026-10-18T02:00:00.000Z',
    processExists: () => false
  });
  const result = rollbackStaleRunningRecovery({ stateDir, recoveryId: normalized.recovery_id, now: '2026-10-18T02:01:00.000Z' });
  assert.equal(result.ok, true);
  assert.equal(result.restored_status.status, 'running');
  assert.equal(result.restored_status.recovery_rollback_id, normalized.recovery_id);
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).status, 'running');
  assert.match(fs.readFileSync(path.join(stateDir, 'run-state-recovery.jsonl'), 'utf8'), /"phase":"rolled_back"/u);
});

test('fails closed when status, pid file, and owner generation disagree', () => {
  const { stateDir, statusPath, pidPath, ownerPath } = fixture();
  fs.writeFileSync(statusPath, JSON.stringify({
    status: 'running',
    run_id: 'generation-mismatch',
    pid_file: pidPath,
    supervisor_pid: 1234,
    supervisor_generation: 'status-generation'
  }));
  fs.writeFileSync(pidPath, '5678');
  writeOwner(ownerPath, 5678, 'owner-generation');
  const result = normalizeStaleRunningStatus({
    stateDir,
    pidFile: pidPath,
    rootDir: '/repo',
    processExists: () => true,
    getProcessCommand: () => 'bash /repo/phase-loop.sh supervise',
    listSupervisors: () => [5678]
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'supervisor_ownership_conflict');
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).status, 'running');
});

test('fails closed when a live supervisor command belongs to another root', () => {
  const { stateDir, statusPath, pidPath, ownerPath } = fixture();
  fs.writeFileSync(statusPath, JSON.stringify({
    status: 'running',
    run_id: 'foreign-root',
    pid_file: pidPath,
    supervisor_pid: 1234,
    supervisor_generation: 'generation-1'
  }));
  fs.writeFileSync(pidPath, '1234');
  writeOwner(ownerPath);
  const result = normalizeStaleRunningStatus({
    stateDir,
    pidFile: pidPath,
    rootDir: '/repo',
    processExists: () => true,
    getProcessCommand: () => 'bash /repo-evil/phase-loop.sh supervise',
    listSupervisors: () => [1234]
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'supervisor_ownership_conflict');
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).status, 'running');
});

test('accepts a supervisor launched through a symlinked root path', () => {
  const { stateDir, pidPath, ownerPath } = fixture();
  const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie root '));
  const linkedRoot = `${realRoot}-link`;
  fs.writeFileSync(path.join(realRoot, 'phase-loop.sh'), '');
  fs.symlinkSync(realRoot, linkedRoot, 'dir');
  fs.writeFileSync(path.join(stateDir, 'status.json'), JSON.stringify({
    status: 'running',
    run_id: 'symlinked-root',
    supervisor_pid: 1234,
    supervisor_generation: 'generation-1'
  }));
  fs.writeFileSync(pidPath, '1234');
  fs.writeFileSync(ownerPath, JSON.stringify({ schema_version: 1, pid: 1234, generation: 'generation-1', root_dir: realRoot }));
  const result = inspectSupervisorOwnership({
    stateDir,
    pidFile: pidPath,
    ownerFile: ownerPath,
    rootDir: linkedRoot,
    processExists: () => true,
    getProcessCommand: () => `bash ${linkedRoot}/phase-loop.sh supervise`,
    listSupervisors: () => [1234]
  });
  assert.equal(result.command_looks_like_supervisor, true);
  assert.equal(result.ownership_ok, true);
});

test('keeps an authorized continuation within the watchdog deadline', () => {
  const { stateDir, statusPath, pidPath, ownerPath } = fixture();
  fs.writeFileSync(statusPath, JSON.stringify({
    status: 'running',
    run_id: 'continuation-fresh',
    updated_at: '2026-10-18T01:00:00.000Z',
    continuation_required: true,
    controller_action: 'resume',
    supervisor_pid: 1234,
    supervisor_generation: 'generation-1'
  }));
  fs.writeFileSync(pidPath, '1234');
  writeOwner(ownerPath);
  const result = watchdogContinuationLiveness({
    stateDir,
    pidFile: pidPath,
    ownerFile: ownerPath,
    rootDir: '/repo',
    now: '2026-10-18T01:10:00.000Z',
    maxAgeSeconds: 900,
    processExists: () => true,
    getProcessCommand: () => 'bash /repo/phase-loop.sh supervise',
    listSupervisors: () => [1234]
  });
  assert.equal(result.expired, false);
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).status, 'running');
});

test('fails closed on an unowned fresh continuation before the deadline', () => {
  const { stateDir, statusPath, pidPath } = fixture();
  fs.writeFileSync(statusPath, JSON.stringify({
    status: 'running',
    run_id: 'continuation-unowned-fresh',
    updated_at: '2026-10-18T01:19:59.000Z',
    continuation_required: true,
    controller_action: 'resume',
    supervisor_pid: 5678,
    supervisor_generation: 'generation-1'
  }));
  fs.writeFileSync(pidPath, '5678');
  const result = watchdogContinuationLiveness({
    stateDir,
    pidFile: pidPath,
    rootDir: '/repo',
    now: '2026-10-18T01:20:01.000Z',
    maxAgeSeconds: 900,
    processExists: () => true,
    getProcessCommand: () => 'bash /other-repo/phase-loop.sh supervise',
    listSupervisors: () => [5678]
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'continuation_ownership_unproven');
  assert.equal(result.age_seconds, undefined);
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).status, 'running');
});

test('rejects an invalid watchdog duration without expiring a continuation', () => {
  const { stateDir, statusPath } = fixture();
  fs.writeFileSync(statusPath, JSON.stringify({
    status: 'running',
    run_id: 'continuation-invalid-duration',
    updated_at: '2026-10-18T01:00:00.000Z',
    continuation_required: true,
    controller_action: 'resume'
  }));
  const result = watchdogContinuationLiveness({
    stateDir,
    maxAgeSeconds: 'not-a-duration',
    now: '2026-10-18T01:20:01.000Z'
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'continuation_watchdog_duration_invalid');
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).status, 'running');
  assert.equal(fs.existsSync(path.join(stateDir, 'run-state-recovery.jsonl')), false);
});

test('audits and terminalizes an expired continuation held by a live hung owner', () => {
  const { stateDir, statusPath, pidPath, ownerPath } = fixture();
  fs.writeFileSync(statusPath, JSON.stringify({
    status: 'running',
    run_id: 'continuation-stale',
    updated_at: '2026-10-18T01:00:00.000Z',
    continuation_required: true,
    controller_action: 'resume',
    supervisor_pid: 1234,
    supervisor_generation: 'generation-1'
  }));
  fs.writeFileSync(pidPath, '1234');
  writeOwner(ownerPath);
  const result = watchdogContinuationLiveness({
    stateDir,
    pidFile: pidPath,
    ownerFile: ownerPath,
    rootDir: '/repo',
    now: '2026-10-18T01:20:01.000Z',
    maxAgeSeconds: 900,
    runStamp: 'watchdog-run',
    processExists: () => true,
    getProcessCommand: () => 'bash /repo/phase-loop.sh supervise',
    listSupervisors: () => [1234]
  });
  assert.equal(result.ok, true);
  assert.equal(result.redelegate, true);
  const replacement = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  assert.equal(replacement.status, 'blocked');
  assert.equal(replacement.continuation_required, false);
  assert.equal(replacement.stop_reason, 'continuation_watchdog_expired');
  const audit = fs.readFileSync(path.join(stateDir, 'run-state-recovery.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(audit.map((record) => record.phase), ['prepared', 'applied']);
  assert.equal(audit[0].kind, 'phase_loop_continuation_watchdog');
});

test('does not replace a continuation refreshed during ownership inspection', () => {
  const { stateDir, statusPath, pidPath, ownerPath } = fixture();
  const staleStatus = {
    status: 'running',
    run_id: 'continuation-race',
    updated_at: '2026-10-18T01:00:00.000Z',
    continuation_required: true,
    controller_action: 'resume',
    supervisor_pid: 1234,
    supervisor_generation: 'generation-1'
  };
  fs.writeFileSync(statusPath, JSON.stringify(staleStatus));
  fs.writeFileSync(pidPath, '1234');
  writeOwner(ownerPath);
  let inspected = false;
  const result = watchdogContinuationLiveness({
    stateDir,
    pidFile: pidPath,
    ownerFile: ownerPath,
    rootDir: '/repo',
    now: '2026-10-18T01:20:01.000Z',
    maxAgeSeconds: 900,
    processExists: () => true,
    getProcessCommand: () => {
      if (!inspected) {
        inspected = true;
        fs.writeFileSync(statusPath, JSON.stringify({
          ...staleStatus,
          updated_at: '2026-10-18T01:19:59.000Z'
        }));
      }
      return 'bash /repo/phase-loop.sh supervise';
    },
    listSupervisors: () => [1234]
  });
  assert.equal(result.ok, true);
  assert.equal(result.expired, false);
  assert.equal(result.reason, 'continuation_changed_during_watchdog_check');
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).updated_at, '2026-10-18T01:19:59.000Z');
  assert.equal(fs.existsSync(path.join(stateDir, 'run-state-recovery.jsonl')), false);
});

test('run-once installs exit and signal terminalization hooks after entering running state', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const controller = fs.readFileSync(path.join(repoRoot, 'phase-loop.sh'), 'utf8');
  assert.ok(controller.includes("trap 'phase_loop_finalize_unexpected_exit \"$?\"' EXIT"));
  assert.ok(controller.includes("trap 'phase_loop_handle_run_signal INT' INT"));
  assert.ok(controller.includes("trap 'phase_loop_handle_run_signal TERM' TERM"));
  assert.match(controller, /Unexpected phase-loop run-once exit; terminalized status/u);
  assert.match(controller, /--owner-pid "\$\{PHASE_LOOP_SUPERVISOR_PID:-\}"/u);
  assert.match(controller, /continuation_required\)\n[\s\S]*write_status "running"[^\n]*"true"/u);
  assert.match(controller, /PHASE_LOOP_DEFERRED_SIGNAL_PENDING=1/gu);
  assert.match(controller, /phase_loop_drain_deferred_signal/gu);
  assert.match(controller, /PHASE_LOOP_DEFERRED_SIGNAL_FILE/gu);
  assert.match(controller, /mv "\$tmp_status" "\$STATUS_FILE"[\s\S]*PHASE_LOOP_STATUS_WRITE_IN_PROGRESS=0[\s\S]*if \[ "\$\{PHASE_LOOP_DEFERRED_SIGNAL_PENDING:-0\}"/u);
  assert.match(controller, /PHASE_LOOP_STATUS_WRITE_IN_PROGRESS=0[\s\S]*if \[ -n "\$force_status_exit_code" \]; then\n    exit "\$force_status_exit_code"/u);
  assert.match(controller, /normalize_stale_running_before_start[\s\S]*write_status "starting"/u);
  assert.match(controller, /SUPERVISOR_OWNER_FILE=/u);
  assert.match(controller, /write_supervisor_owner/gu);
  assert.match(controller, /phase_loop_watch_continuation_liveness/gu);
  assert.match(controller, /phase_loop_migrate_legacy_state[\s\S]*phase_loop_watch_continuation_liveness/u);
  assert.match(controller, /PHASE_LOOP_CONTINUATION_WATCHDOG_SECONDS/u);
  assert.match(controller, /--owner-generation/u);
});

function writeLegacyFixture(stateDir, { pid = 48100, supervisorPid = 33061, rootDir = '/repo' } = {}) {
  fs.writeFileSync(path.join(stateDir, 'status.json'), JSON.stringify({
    status: 'running',
    detail: 'legacy continuation after host loss',
    run_id: 'legacy-continuation',
    updated_at: '2026-10-18T16:37:00.000Z',
    continuation_required: true,
    controller_action: 'resume',
    supervisor_pid: supervisorPid,
    supervisor_generation: 'legacy-generation',
    workspace_root: rootDir
  }));
  fs.writeFileSync(path.join(stateDir, 'phase-loop.pid'), `${pid}\n`);
  fs.mkdirSync(path.join(stateDir, 'todo-claims'), { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'todo-claims', 'current.json'), JSON.stringify({
    claim_id: 'legacy-claim',
    status: 'in_progress',
    selected_todo: '- [ ] legacy migration fixture'
  }));
  fs.mkdirSync(path.join(stateDir, 'runs'), { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'runs', 'legacy.target.before'), 'target-before\n');
  fs.mkdirSync(path.join(stateDir, 'phase-loop.lock'), { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'phase-loop.lock', 'pid'), `${supervisorPid}\n`);
}

function sameRootLegacyRecords(stateDir) {
  return [{
    pid: 33061,
    command: 'bash /repo/phase-loop.sh supervise',
    start_time: 'Sun Oct 18 16:30:00 2026',
    state_dir: stateDir
  }];
}

function defaultLegacyFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-default-root-'));
  const stateDir = path.join(rootDir, '.brownie', 'private', 'phase-loop');
  fs.mkdirSync(stateDir, { recursive: true });
  return { rootDir, stateDir, statusPath: path.join(stateDir, 'status.json') };
}

test('archives and rebaselines a confirmed same-root legacy owner exactly once', () => {
  const { stateDir, statusPath } = fixture();
  writeLegacyFixture(stateDir);
  let live = true;
  let stopCalls = 0;
  const result = migrateLegacyPhaseLoopState({
    stateDir,
    rootDir: '/repo',
    now: '2026-10-18T17:00:00.000Z',
    processExists: (pid) => live && pid === 33061,
    getProcessCommand: (pid) => pid === 33061 ? 'bash /repo/phase-loop.sh supervise' : '',
    getProcessStartTime: () => 'Sun Oct 18 16:30:00 2026',
    listAllSupervisors: () => live ? sameRootLegacyRecords(stateDir) : [],
    stopSupervisor: ({ candidate }) => {
      stopCalls += 1;
      assert.equal(candidate.pid, 33061);
      live = false;
      fs.rmSync(path.join(stateDir, 'phase-loop.lock'), { recursive: true, force: true });
      return { ok: true };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.equal(result.stopped_legacy_pid, 33061);
  assert.equal(stopCalls, 1);
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).status, 'recovered_legacy_state');
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).continuation_required, false);
  assert.equal(fs.existsSync(path.join(stateDir, 'phase-loop.pid')), false);
  assert.equal(fs.existsSync(path.join(stateDir, 'phase-loop-owner.json')), false);
  assert.equal(fs.existsSync(path.join(stateDir, 'phase-loop.lock')), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(result.archive_path, 'manifest.json'), 'utf8'));
  assert.equal(manifest.kind, 'phase_loop_legacy_state_archive');
  assert.ok(manifest.files.some((entry) => entry.category === 'claim'));
  assert.ok(manifest.files.some((entry) => entry.category === 'target_snapshot'));
});

test('keeps an original manifest in the archive payload beside the recovery manifest', () => {
  const { stateDir } = fixture();
  writeLegacyFixture(stateDir);
  fs.writeFileSync(path.join(stateDir, 'manifest.json'), 'legacy-manifest\n');
  const result = migrateLegacyPhaseLoopState({
    stateDir,
    rootDir: '/repo',
    processExists: () => false,
    listAllSupervisors: () => []
  });
  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(path.join(result.archive_path, 'payload', 'manifest.json'), 'utf8'), 'legacy-manifest\n');
  const manifest = JSON.parse(fs.readFileSync(path.join(result.archive_path, 'manifest.json'), 'utf8'));
  assert.equal(manifest.payload_root, 'payload');
  assert.ok(manifest.files.some((entry) => entry.path === 'manifest.json'));
});

test('quiesces a confirmed legacy owner before enforcing archive snapshot stability', () => {
  const { stateDir } = fixture();
  writeLegacyFixture(stateDir);
  let live = true;
  let quiesced = false;
  const result = migrateLegacyPhaseLoopState({
    stateDir,
    rootDir: '/repo',
    processExists: (pid) => live && pid === 33061,
    getProcessCommand: () => 'bash /repo/phase-loop.sh supervise',
    getProcessStartTime: () => 'Sun Oct 18 16:30:00 2026',
    listAllSupervisors: () => live ? sameRootLegacyRecords(stateDir) : [],
    quiesceSupervisor: () => {
      quiesced = true;
      return { ok: true, resume: () => { quiesced = false; return { ok: true }; } };
    },
    archiveSnapshot: () => {
      assert.equal(quiesced, true);
      return { fingerprint: 'stable', files: [], archive_path: 'archive', manifest_path: 'manifest' };
    },
    stateSnapshotReader: () => ({ fingerprint: 'stable', files: [] }),
    stopSupervisor: () => {
      assert.equal(quiesced, false);
      live = false;
      fs.rmSync(path.join(stateDir, 'phase-loop.lock'), { recursive: true, force: true });
      return { ok: true };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(quiesced, false);
});

test('resumes processes already quiesced when a later identity check fails', () => {
  const signals = [];
  const result = quiesceLegacySupervisor({
    candidate: { pid: 33061, start_time: 'candidate' },
    processExists: () => true,
    getProcessStartTime: (pid) => pid === 33061 ? 'candidate' : '',
    listDescendants: () => [33062],
    killProcess: (pid, signal) => { signals.push([pid, signal]); }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'legacy_process_identity_changed');
  assert.deepEqual(signals, [[33061, 0], [33061, 'SIGSTOP'], [33061, 'SIGCONT']]);
});

test('blocks a live lock owned by a different PID before stopping the candidate', () => {
  const { stateDir, statusPath } = fixture();
  writeLegacyFixture(stateDir);
  fs.writeFileSync(path.join(stateDir, 'phase-loop.lock', 'pid'), '33062\n');
  let stopCalls = 0;
  const result = migrateLegacyPhaseLoopState({
    stateDir,
    rootDir: '/repo',
    processExists: (pid) => pid === 33061 || pid === 33062,
    getProcessCommand: (pid) => pid === 33061 ? 'bash /repo/phase-loop.sh supervise' : 'node unrelated-lock-owner.mjs',
    getProcessStartTime: () => 'Sun Oct 18 16:30:00 2026',
    listAllSupervisors: () => [{ pid: 33061, command: 'bash /repo/phase-loop.sh supervise', start_time: 'Sun Oct 18 16:30:00 2026', state_dir: stateDir }],
    stopSupervisor: () => { stopCalls += 1; return { ok: true }; }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'legacy_state_ownership_unproven');
  assert.equal(result.inspection.reason, 'legacy_live_lock_owner_unproven');
  assert.equal(stopCalls, 0);
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).status, 'blocked');
});

test('reuses an existing archive for a repeated blocked migration with the same state', () => {
  const { stateDir, statusPath } = fixture();
  writeLegacyFixture(stateDir);
  const options = {
    stateDir,
    rootDir: '/repo',
    processExists: (pid) => pid === 33061 || pid === 33062,
    getProcessCommand: () => 'bash /repo/phase-loop.sh supervise',
    getProcessStartTime: () => 'Sun Oct 18 16:30:00 2026',
    listAllSupervisors: () => [{ pid: 33061, command: 'bash /repo/phase-loop.sh supervise', start_time: 'Sun Oct 18 16:30:00 2026', state_dir: '/other-state' }]
  };
  const first = migrateLegacyPhaseLoopState(options);
  const second = migrateLegacyPhaseLoopState(options);
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.equal(second.recovery_id, first.recovery_id);
  assert.equal(second.archive_path, first.archive_path);
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).recovery_id, first.recovery_id);
  assert.deepEqual(fs.readdirSync(path.join(stateDir, 'legacy-recovery')), [first.recovery_id]);
});

test('blocks a same-root supervisor whose state directory is different', () => {
  const { stateDir, statusPath } = fixture();
  writeLegacyFixture(stateDir);
  const foreignState = [{
    pid: 33061,
    command: 'bash /repo/phase-loop.sh supervise',
    start_time: 'Sun Oct 18 16:30:00 2026',
    state_dir: '/other-state'
  }];
  let stopCalls = 0;
  const result = migrateLegacyPhaseLoopState({
    stateDir,
    rootDir: '/repo',
    processExists: () => true,
    getProcessCommand: () => foreignState[0].command,
    getProcessStartTime: () => foreignState[0].start_time,
    listAllSupervisors: () => foreignState,
    stopSupervisor: () => { stopCalls += 1; return { ok: true }; }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'legacy_state_ownership_unproven');
  assert.equal(result.inspection.reason, 'legacy_foreign_supervisor');
  assert.equal(stopCalls, 0);
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).status, 'blocked');
  assert.equal(fs.readFileSync(path.join(stateDir, 'phase-loop.pid'), 'utf8'), '48100\n');
});

test('confirms a default-state supervisor without an explicit state-dir environment value', () => {
  const { rootDir, stateDir, statusPath } = defaultLegacyFixture();
  writeLegacyFixture(stateDir, { rootDir });
  let live = true;
  const result = migrateLegacyPhaseLoopState({
    stateDir,
    rootDir,
    processExists: (pid) => live && pid === 33061,
    getProcessCommand: () => `bash ${rootDir}/phase-loop.sh supervise`,
    getProcessStartTime: () => 'Sun Oct 18 16:30:00 2026',
    listAllSupervisors: () => live ? [{
      pid: 33061,
      command: `bash ${rootDir}/phase-loop.sh supervise`,
      start_time: 'Sun Oct 18 16:30:00 2026'
    }] : [],
    stopSupervisor: () => { live = false; fs.rmSync(path.join(stateDir, 'phase-loop.lock'), { recursive: true, force: true }); return { ok: true }; }
  });
  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).status, 'recovered_legacy_state');
});

test('rescans descendants before force-killing a respawned legacy child', () => {
  const live = new Set([33061, 44001, 44002]);
  const signals = [];
  let scans = 0;
  const result = terminateLegacySupervisor({
    candidate: { pid: 33061, start_time: 'candidate' },
    processExists: (pid) => live.has(pid),
    getProcessStartTime: (pid) => ({ 33061: 'candidate', 44001: 'child-1', 44002: 'child-2' }[pid] || ''),
    listDescendants: () => {
      scans += 1;
      return scans <= 2 ? [44001] : [44001, 44002];
    },
    killProcess: (pid, signal) => {
      signals.push([pid, signal]);
      if (signal === 'SIGTERM' && pid === 44001) live.delete(pid);
      if (signal === 'SIGKILL') live.delete(pid);
    },
    sleep: () => {}
  });
  assert.equal(result.ok, true);
  assert.ok(scans > 2);
  assert.ok(signals.some(([pid, signal]) => pid === 44002 && signal === 'SIGKILL'));
});

test('blocks and preserves state when a foreign supervisor is live', () => {
  const { stateDir, statusPath } = fixture();
  writeLegacyFixture(stateDir);
  const foreign = [{ pid: 33061, command: 'bash /foreign/phase-loop.sh supervise', start_time: 'Sun Oct 18 16:30:00 2026' }];
  let stopCalls = 0;
  const result = migrateLegacyPhaseLoopState({
    stateDir,
    rootDir: '/repo',
    processExists: () => true,
    getProcessCommand: () => foreign[0].command,
    getProcessStartTime: () => foreign[0].start_time,
    listAllSupervisors: () => foreign,
    stopSupervisor: () => { stopCalls += 1; return { ok: true }; }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'legacy_state_ownership_unproven');
  assert.equal(result.inspection.reason, 'legacy_foreign_supervisor');
  assert.equal(stopCalls, 0);
  const blocked = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.continuation_required, true);
  assert.equal(fs.readFileSync(path.join(stateDir, 'phase-loop.pid'), 'utf8'), '48100\n');
  assert.ok(fs.existsSync(path.join(result.archive_path, 'manifest.json')));
});

test('ignores an unrelated foreign-checkout supervisor when this state does not reference it', () => {
  const { stateDir, statusPath } = fixture();
  writeLegacyFixture(stateDir, { supervisorPid: 33062 });
  const unrelated = [{ pid: 33061, command: 'bash /foreign-checkout/phase-loop.sh supervise', start_time: 'Sun Oct 18 16:30:00 2026' }];
  const result = migrateLegacyPhaseLoopState({
    stateDir,
    rootDir: '/repo',
    processExists: (pid) => pid === 33061,
    getProcessCommand: () => unrelated[0].command,
    getProcessStartTime: () => unrelated[0].start_time,
    listAllSupervisors: () => unrelated
  });
  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).status, 'recovered_legacy_state');
});

test('blocks a foreign-root supervisor that explicitly reports this state directory', () => {
  const { stateDir, statusPath } = fixture();
  writeLegacyFixture(stateDir, { supervisorPid: 33062 });
  const foreign = [{
    pid: 33061,
    command: 'bash /foreign-checkout/phase-loop.sh supervise',
    start_time: 'Sun Oct 18 16:30:00 2026',
    state_dir: stateDir
  }];
  let stopCalls = 0;
  const result = migrateLegacyPhaseLoopState({
    stateDir,
    rootDir: '/repo',
    processExists: () => true,
    getProcessCommand: () => foreign[0].command,
    getProcessStartTime: () => foreign[0].start_time,
    listAllSupervisors: () => foreign,
    stopSupervisor: () => { stopCalls += 1; return { ok: true }; }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'legacy_state_ownership_unproven');
  assert.equal(result.inspection.reason, 'legacy_foreign_supervisor');
  assert.equal(stopCalls, 0);
  assert.equal(result.inspection.foreign_root_state_dir_supervisors.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).status, 'blocked');
});

test('reads a large process table in one command and enriches supervisors only', () => {
  const enriched = [];
  const records = allSupervisorProcessRecords({
    readProcessTable: () => `${Array.from({ length: 200 }, (_, index) => ` ${index + 100} worker-${index}`).join('\n')}\n 33061 bash /repo/phase-loop.sh supervise`,
    processAlive: () => true,
    getStartTime: (pid) => { enriched.push(['start', pid]); return 'supervisor-start'; },
    getStateDir: (pid) => { enriched.push(['state', pid]); return '/state'; }
  });
  assert.deepEqual(records, [{ pid: 33061, command: 'bash /repo/phase-loop.sh supervise', start_time: 'supervisor-start', state_dir: '/state' }]);
  assert.deepEqual(enriched, [['start', 33061], ['state', 33061]]);
});

test('binds supervisor command and start time from one process-table snapshot', () => {
  const records = allSupervisorProcessRecords({
    readProcessTable: () => ' 33061 Mon Oct  7 01:52:00 2026 bash /repo/phase-loop.sh supervise\n',
    processAlive: () => true,
    getStartTime: () => { throw new Error('start time must come from the process table'); },
    getStateDir: () => '/state'
  });
  assert.deepEqual(records, [{
    pid: 33061,
    command: 'bash /repo/phase-loop.sh supervise',
    start_time: 'Mon Oct  7 01:52:00 2026',
    state_dir: '/state'
  }]);
});

test('blocks PID reuse by a non-supervisor without deleting the lock or pidfile', () => {
  const { stateDir, statusPath } = fixture();
  writeLegacyFixture(stateDir);
  const result = migrateLegacyPhaseLoopState({
    stateDir,
    rootDir: '/repo',
    processExists: (pid) => pid === 48100,
    getProcessCommand: () => 'node unrelated-worker.mjs',
    getProcessStartTime: () => 'Sun Oct 18 16:30:00 2026',
    listAllSupervisors: () => []
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'legacy_state_ownership_unproven');
  assert.equal(result.inspection.reason, 'legacy_pid_reused_by_other_process');
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).continuation_required, true);
  assert.equal(fs.existsSync(path.join(stateDir, 'phase-loop.lock')), true);
  assert.equal(fs.readFileSync(path.join(stateDir, 'phase-loop.pid'), 'utf8'), '48100\n');
});

test('fails closed when the audit archive cannot be created', () => {
  const { stateDir, statusPath } = fixture();
  writeLegacyFixture(stateDir);
  const before = fs.readFileSync(statusPath, 'utf8');
  const result = migrateLegacyPhaseLoopState({
    stateDir,
    rootDir: '/repo',
    processExists: () => false,
    listAllSupervisors: () => [],
    archiveSnapshot: () => { throw new Error('archive disk full'); }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'legacy_state_archive_failed');
  assert.equal(fs.readFileSync(statusPath, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(stateDir, 'legacy-recovery')), false);
});

test('refuses a status race discovered after the archive and never starts a second owner', () => {
  const { stateDir, statusPath } = fixture();
  writeLegacyFixture(stateDir);
  let inspections = 0;
  let stopCalls = 0;
  const result = migrateLegacyPhaseLoopState({
    stateDir,
    rootDir: '/repo',
    processExists: (pid) => pid === 33061,
    getProcessCommand: () => 'bash /repo/phase-loop.sh supervise',
    getProcessStartTime: () => 'Sun Oct 18 16:30:00 2026',
    listAllSupervisors: () => {
      inspections += 1;
      if (inspections === 2) {
        const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
        status.updated_at = '2026-10-18T16:59:59.000Z';
        fs.writeFileSync(statusPath, JSON.stringify(status));
      }
      return sameRootLegacyRecords(stateDir);
    },
    stopSupervisor: () => { stopCalls += 1; return { ok: true }; }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'legacy_state_changed_during_migration');
  assert.equal(stopCalls, 0);
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).status, 'running');
  assert.ok(fs.existsSync(path.join(result.archive_path, 'manifest.json')));
});

test('refuses rebaseline when stopping the legacy owner dirties claim state', () => {
  const { stateDir, statusPath } = fixture();
  writeLegacyFixture(stateDir);
  let live = true;
  const result = migrateLegacyPhaseLoopState({
    stateDir,
    rootDir: '/repo',
    processExists: (pid) => live && pid === 33061,
    getProcessCommand: () => 'bash /repo/phase-loop.sh supervise',
    getProcessStartTime: () => 'Sun Oct 18 16:30:00 2026',
    listAllSupervisors: () => live ? sameRootLegacyRecords(stateDir) : [],
    stopSupervisor: () => {
      live = false;
      fs.writeFileSync(path.join(stateDir, 'todo-claims', 'current.json'), JSON.stringify({ claim_id: 'changed-during-stop' }));
      return { ok: true };
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'legacy_supervisor_stop_race');
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).status, 'running');
  assert.equal(fs.existsSync(path.join(stateDir, 'phase-loop.pid')), true);
});

test('leaves continuation blocked when reversible cleanup fails after owner stop', () => {
  const { stateDir, statusPath } = fixture();
  writeLegacyFixture(stateDir);
  let live = true;
  const result = migrateLegacyPhaseLoopState({
    stateDir,
    rootDir: '/repo',
    processExists: (pid) => live && pid === 33061,
    getProcessCommand: () => 'bash /repo/phase-loop.sh supervise',
    getProcessStartTime: () => 'Sun Oct 18 16:30:00 2026',
    listAllSupervisors: () => live ? sameRootLegacyRecords(stateDir) : [],
    stopSupervisor: () => { live = false; return { ok: true }; },
    runtimeCleaner: () => ({ ok: false, code: 'legacy_cleanup_fixture_failure' })
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'legacy_cleanup_fixture_failure');
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).continuation_required, true);
  assert.equal(fs.existsSync(path.join(stateDir, 'phase-loop.pid')), true);
});
