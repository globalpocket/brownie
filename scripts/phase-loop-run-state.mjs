import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function readJsonLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function appendJsonLine(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const handle = fs.openSync(file, 'a', 0o600);
  try {
    fs.writeSync(handle, `${JSON.stringify(value)}\n`);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function writeJsonAtomically(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(temporary, file);
}

function fsyncDirectory(directory) {
  const handle = fs.openSync(directory, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function copyFileAndFsync(source, destination) {
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o600);
  const handle = fs.openSync(destination, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function hashBytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function collectStateFiles(stateDir) {
  const entries = [];
  const visit = (directory, relativeDirectory = '') => {
    let names;
    try {
      names = fs.readdirSync(directory).sort();
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const name of names) {
      if (!relativeDirectory && name === 'legacy-recovery') continue;
      const absolute = path.join(directory, name);
      const relative = path.join(relativeDirectory, name);
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) {
        visit(absolute, relative);
      } else if (stat.isFile() || stat.isSymbolicLink()) {
        const value = stat.isSymbolicLink()
          ? Buffer.from(`symlink:${fs.readlinkSync(absolute)}`, 'utf8')
          : fs.readFileSync(absolute);
        const category = relative.startsWith(`todo-claims${path.sep}`)
          ? 'claim'
          : relative.startsWith(`runs${path.sep}`) && relative.endsWith('.target.before')
            ? 'target_snapshot'
            : 'state';
        entries.push({
          path: relative.split(path.sep).join('/'),
          category,
          kind: stat.isSymbolicLink() ? 'symlink' : 'file',
          sha256: hashBytes(value),
          bytes: value.length
        });
      }
    }
  };
  visit(stateDir);
  return entries;
}

function stateSnapshot(stateDir) {
  const files = collectStateFiles(stateDir);
  const fingerprint = hashBytes(files.map((entry) => `${entry.path}\0${entry.kind}\0${entry.sha256}\0${entry.bytes}`).join('\n'));
  return { fingerprint, files };
}

function archiveLegacyStateAtomically({ stateDir, recoveryId, reason, now = new Date().toISOString() }) {
  const before = stateSnapshot(stateDir);
  const recoveryRoot = path.join(stateDir, 'legacy-recovery');
  const temporary = path.join(recoveryRoot, `.${recoveryId}.tmp`);
  const archivePath = path.join(recoveryRoot, recoveryId);
  const payloadRoot = path.join(temporary, 'payload');
  fs.mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 });
  fsyncDirectory(stateDir);
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  try {
    for (const entry of before.files) {
      const source = path.join(stateDir, entry.path);
      const destination = path.join(payloadRoot, entry.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      if (entry.kind === 'symlink') {
        fs.symlinkSync(fs.readlinkSync(source), destination);
      } else {
        copyFileAndFsync(source, destination);
      }
    }
    const manifest = {
      schema_version: 1,
      kind: 'phase_loop_legacy_state_archive',
      recovery_id: recoveryId,
      reason,
      archived_at: now,
      state_dir: stateDir,
      state_fingerprint: before.fingerprint,
      payload_root: 'payload',
      files: before.files
    };
    writeJsonAtomically(path.join(temporary, 'manifest.json'), manifest);
    const directories = new Set([temporary, payloadRoot]);
    for (const entry of before.files) {
      directories.add(path.dirname(path.join(payloadRoot, entry.path)));
    }
    [...directories]
      .sort((left, right) => right.split(path.sep).length - left.split(path.sep).length)
      .forEach((directory) => fsyncDirectory(directory));
    fs.renameSync(temporary, archivePath);
    fsyncDirectory(recoveryRoot);
    return { archive_path: archivePath, manifest_path: path.join(archivePath, 'manifest.json'), ...before };
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function reusableLegacyBlockedArchive({ stateDir, inspected, stateSnapshotReader }) {
  const status = inspected.status;
  const recoveryId = status?.recovery_id;
  if (status?.status !== 'blocked'
    || status.continuation_required !== true
    || status.controller_action !== 'resume'
    || typeof recoveryId !== 'string'
    || path.basename(recoveryId) !== recoveryId) {
    return null;
  }
  const archivePath = path.join(stateDir, 'legacy-recovery', recoveryId);
  const manifestPath = path.join(archivePath, 'manifest.json');
  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch {
    return null;
  }
  if (!manifest
    || manifest.kind !== 'phase_loop_legacy_state_archive'
    || manifest.recovery_id !== recoveryId
    || manifest.state_dir !== stateDir
    || manifest.reason !== inspected.reason
    || !Array.isArray(manifest.files)
    || !sameStateFiles(stateSnapshotReader(stateDir), manifest, new Set(['status.json']))) {
    return null;
  }
  return {
    ok: false,
    blocked: true,
    code: 'legacy_state_ownership_unproven',
    recovery_id: recoveryId,
    archive_path: archivePath,
    status,
    inspection: inspected
  };
}

function processIsAlive(pid, kill = process.kill) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function processCommand(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function processStartTime(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function processStateDir(pid) {
  try {
    const environment = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
    const entry = environment.split('\0').find((value) => value.startsWith('PHASE_LOOP_STATE_DIR='));
    if (entry) return entry.slice('PHASE_LOOP_STATE_DIR='.length);
  } catch {
    // macOS does not expose /proc; use ps below when available.
  }
  try {
    const command = execFileSync('ps', ['-wwE', '-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
    const match = command.match(/(?:^|\s)PHASE_LOOP_STATE_DIR=([^\s]+)/u);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

function canonicalizePath(value) {
  if (!value) return '';
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

function supervisorCommandMatchesRoot(command, rootDir) {
  const canonicalRootDir = canonicalizePath(rootDir);
  if (!canonicalRootDir || !/\bphase-loop\.sh\b.*\bsupervise\b/u.test(command)) return false;
  const commandRootCandidates = new Set([canonicalRootDir, path.resolve(rootDir)]);
  return [...commandRootCandidates].some((candidateRoot) => (
    command.includes(path.join(candidateRoot, 'phase-loop.sh'))
  ));
}

function commandLooksLikeSupervisor(command) {
  return /\bphase-loop\.sh\b.*\bsupervise\b/u.test(command);
}

function reportedSupervisorStateDir(record) {
  if (typeof record?.state_dir === 'string' && record.state_dir) return record.state_dir;
  if (typeof record?.environment?.PHASE_LOOP_STATE_DIR === 'string' && record.environment.PHASE_LOOP_STATE_DIR) {
    return record.environment.PHASE_LOOP_STATE_DIR;
  }
  const match = String(record?.command || '').match(/(?:^|\s)PHASE_LOOP_STATE_DIR=([^\s]+)/u);
  return match?.[1] || '';
}

function supervisorStateDirMatches(record, stateDir, rootDir = '') {
  const reported = reportedSupervisorStateDir(record);
  if (reported) return canonicalizePath(reported) === canonicalizePath(stateDir);
  const defaultStateDir = rootDir
    ? path.join(canonicalizePath(rootDir), '.brownie', 'private', 'phase-loop')
    : '';
  return Boolean(defaultStateDir && canonicalizePath(defaultStateDir) === canonicalizePath(stateDir));
}

function supervisorStateDirProof(record, stateDir, rootDir) {
  return Boolean(reportedSupervisorStateDir(record) || supervisorStateDirMatches(record, stateDir, rootDir));
}

export function allSupervisorProcessRecords({
  readProcessTable = null,
  processAlive = processIsAlive,
  getStartTime = null,
  getStateDir = null
} = {}) {
  const startTimeReader = getStartTime || ((pid) => processStartTime(pid));
  const stateDirReader = getStateDir || ((pid) => processStateDir(pid));
  let output = '';
  if (readProcessTable) output = readProcessTable();
  else {
    try {
      output = execFileSync('ps', ['-axo', 'pid=,lstart=,command='], { encoding: 'utf8' });
    } catch {
      return [];
    }
  }
  return output.split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(.*)$/u);
    const pid = Number.parseInt(match?.[1] || '', 10);
    let command = match?.[2]?.trim() || '';
    const snapshotStart = command.match(/^([A-Z][a-z]{2} [A-Z][a-z]{2}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(.*)$/u);
    const start_time = snapshotStart?.[1] || '';
    if (snapshotStart) command = snapshotStart[2].trim();
    if (!Number.isInteger(pid) || pid <= 1 || !processAlive(pid)) return [];
    if (!commandLooksLikeSupervisor(command)) return [];
    return [{ pid, command, start_time: start_time || startTimeReader(pid), state_dir: stateDirReader(pid) }];
  });
}

function liveSupervisorPids(rootDir) {
  return allSupervisorProcessRecords()
    .filter((record) => supervisorCommandMatchesRoot(record.command, rootDir))
    .map((record) => record.pid);
}

function readPid(file) {
  try {
    const pid = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    return Number.isInteger(pid) && pid > 1 ? pid : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function readOwner(ownerFile) {
  return readJson(ownerFile) || null;
}

function ownerMatches({ status, pid, owner, ownerPid, ownerGeneration, rootDir, ownerRootDir }) {
  if (!status || !owner || !pid) return false;
  if (status.supervisor_pid !== pid || owner.pid !== pid) return false;
  if (!status.supervisor_generation || status.supervisor_generation !== owner.generation) return false;
  if (!rootDir || !ownerRootDir || rootDir !== ownerRootDir) return false;
  if (Number.isInteger(ownerPid) && ownerPid !== pid) return false;
  if (ownerGeneration && ownerGeneration !== owner.generation) return false;
  return true;
}

function continuationVersion(status) {
  if (!status) return null;
  return JSON.stringify({
    run_id: status.run_id ?? null,
    updated_at: status.updated_at ?? null,
    supervisor_generation: status.supervisor_generation ?? null,
    continuation_required: status.continuation_required ?? null,
    controller_action: status.controller_action ?? null
  });
}

export function inspectSupervisorOwnership({
  stateDir,
  pidFile = path.join(stateDir, 'phase-loop.pid'),
  ownerFile = path.join(stateDir, 'phase-loop-owner.json'),
  rootDir = '',
  ownerPid = null,
  ownerGeneration = null,
  processExists = (pid) => processIsAlive(pid),
  getProcessCommand = processCommand,
  listSupervisors = () => liveSupervisorPids(rootDir)
}) {
  const status = readJson(path.join(stateDir, 'status.json'));
  const pid = readPid(pidFile);
  const owner = readOwner(ownerFile);
  const livePid = pid && processExists(pid);
  const canonicalRootDir = canonicalizePath(rootDir);
  const canonicalOwnerRootDir = canonicalizePath(owner?.root_dir);
  const matchingOwner = ownerMatches({
    status,
    pid,
    owner,
    ownerPid,
    ownerGeneration,
    rootDir: canonicalRootDir,
    ownerRootDir: canonicalOwnerRootDir
  });
  const command = livePid
    ? (getProcessCommand === processCommand ? processCommand(pid) : getProcessCommand(pid))
    : '';
  const commandLooksLikeSupervisor = supervisorCommandMatchesRoot(command, rootDir);
  const supervisors = [...new Set(listSupervisors().filter((candidate) => Number.isInteger(candidate) && candidate > 1))];
  const liveSupervisors = supervisors.filter((candidate) => processExists(candidate));
  return {
    status,
    pid,
    owner,
    live_pid: livePid ? pid : null,
    matching_owner: matchingOwner,
    command,
    command_looks_like_supervisor: commandLooksLikeSupervisor,
    live_supervisors: liveSupervisors,
    ownership_ok: Boolean(livePid && matchingOwner && commandLooksLikeSupervisor)
  };
}

function sameStateFiles(left, right, ignoredPaths = new Set()) {
  const normalize = (snapshot) => snapshot.files
    .filter((entry) => !ignoredPaths.has(entry.path))
    .map((entry) => `${entry.path}\0${entry.kind}\0${entry.sha256}\0${entry.bytes}`)
    .join('\n');
  return normalize(left) === normalize(right);
}

const LEGACY_STOP_ALLOWED_STATE_PATHS = new Set(['phase-loop.lock/pid']);

function readLockPid(stateDir) {
  return readPid(path.join(stateDir, 'phase-loop.lock', 'pid'));
}

export function inspectLegacyPhaseLoopState({
  stateDir,
  pidFile = path.join(stateDir, 'phase-loop.pid'),
  ownerFile = path.join(stateDir, 'phase-loop-owner.json'),
  rootDir = '',
  processExists = (pid) => processIsAlive(pid),
  getProcessCommand = processCommand,
  getProcessStartTime = processStartTime,
  listAllSupervisors = allSupervisorProcessRecords
}) {
  const statusPath = path.join(stateDir, 'status.json');
  let status;
  let statusError = null;
  try {
    status = readJson(statusPath);
  } catch (error) {
    statusError = error;
  }
  if (statusError) {
    return { ok: false, code: 'legacy_status_unreadable', error: statusError.message };
  }
  if (!status || status.continuation_required !== true || status.controller_action !== 'resume') {
    return { ok: true, migration_needed: false, reason: 'legacy_continuation_not_pending', status };
  }

  let pid = null;
  let pidError = null;
  let pidFilePresent = false;
  try {
    pidFilePresent = fs.existsSync(pidFile);
    pid = readPid(pidFile);
  } catch (error) {
    pidError = error;
  }
  let owner = null;
  let ownerError = null;
  try {
    owner = readOwner(ownerFile);
  } catch (error) {
    ownerError = error;
  }
  const records = [...listAllSupervisors()].filter((record) => Number.isInteger(record?.pid) && record.pid > 1);
  const liveRecords = records.filter((record) => processExists(record.pid));
  const sameRootRecords = liveRecords.filter((record) => supervisorCommandMatchesRoot(record.command || '', rootDir));
  const stateDirRecords = sameRootRecords.filter((record) => supervisorStateDirMatches(record, stateDir, rootDir));
  const foreignStateDirRecords = sameRootRecords.filter((record) => (
    reportedSupervisorStateDir(record) && !supervisorStateDirMatches(record, stateDir, rootDir)
  ));
  const foreignRootStateDirRecords = liveRecords.filter((record) => (
    commandLooksLikeSupervisor(record.command || '')
      && !supervisorCommandMatchesRoot(record.command || '', rootDir)
      && reportedSupervisorStateDir(record)
      && supervisorStateDirMatches(record, stateDir, rootDir)
  ));
  const foreignRecords = liveRecords.filter((record) => (
    commandLooksLikeSupervisor(record.command || '') && !supervisorCommandMatchesRoot(record.command || '', rootDir)
  ));
  const pidLive = pid !== null && processExists(pid);
  const pidRecord = pidLive ? liveRecords.find((record) => record.pid === pid) : null;
  const pidCommand = pidLive ? (pidRecord?.command || getProcessCommand(pid)) : '';
  const pidStartTime = pidLive ? (pidRecord?.start_time || getProcessStartTime(pid)) : '';
  const lockPid = readLockPid(stateDir);
  const lockLive = lockPid !== null && processExists(lockPid);
  const referencedPids = new Set([pid, status.supervisor_pid, lockPid].filter((value) => Number.isInteger(value) && value > 1));
  const associatedSameRootRecords = sameRootRecords.filter((record) => (
    referencedPids.has(record.pid) || supervisorStateDirMatches(record, stateDir, rootDir)
  ));
  const associatedForeignStateDirRecords = [...new Map([
    ...foreignStateDirRecords.filter((record) => referencedPids.has(record.pid)),
    ...foreignRootStateDirRecords
  ].map((record) => [record.pid, record])).values()];
  const associatedForeignRecords = foreignRecords.filter((record) => referencedPids.has(record.pid));
  const ownership = inspectSupervisorOwnership({
    stateDir,
    pidFile,
    ownerFile,
    rootDir,
    processExists,
    getProcessCommand,
    listSupervisors: () => associatedSameRootRecords.map((record) => record.pid)
  });
  if (ownership.ownership_ok) {
    return {
      ok: true,
      migration_needed: false,
      reason: 'legacy_owner_already_current',
      status,
      ownership,
      live_supervisors: liveRecords
    };
  }

  const candidate = stateDirRecords.length === 1 ? stateDirRecords[0] : null;
  const candidateStartTime = candidate?.start_time || (candidate ? getProcessStartTime(candidate.pid) : '');
  const pidIsCandidate = Boolean(candidate && pid === candidate.pid);
  const lockIsCandidate = Boolean(lockLive && candidate && lockPid === candidate.pid);
  const pidIsForeignSupervisor = Boolean(pidLive && commandLooksLikeSupervisor(pidCommand) && !supervisorCommandMatchesRoot(pidCommand, rootDir));
  const pidIsForeignStateSupervisor = Boolean(
    pidLive
      && commandLooksLikeSupervisor(pidCommand)
      && supervisorCommandMatchesRoot(pidCommand, rootDir)
      && pidRecord
      && reportedSupervisorStateDir(pidRecord)
      && !supervisorStateDirMatches(pidRecord, stateDir, rootDir)
  );
  const pidIsOtherLiveProcess = Boolean(pidLive && !commandLooksLikeSupervisor(pidCommand));
  const candidateIsStrictlyConfirmed = Boolean(
    candidate
      && associatedSameRootRecords.length === 1
      && stateDirRecords.length === 1
      && supervisorStateDirProof(candidate, stateDir, rootDir)
      && candidateStartTime
      && !pidError
      && !(pidFilePresent && pid === null)
      && associatedForeignRecords.length === 0
      && associatedForeignStateDirRecords.length === 0
      && !pidIsForeignSupervisor
      && !pidIsOtherLiveProcess
      && (!pidLive || pidIsCandidate || !pid)
      && (!lockLive || lockIsCandidate)
      && (!status.supervisor_pid || status.supervisor_pid === candidate.pid)
  );
  let reason = 'legacy_ownership_unproven';
  if (associatedForeignRecords.length > 0 || associatedForeignStateDirRecords.length > 0 || pidIsForeignSupervisor || pidIsForeignStateSupervisor) reason = 'legacy_foreign_supervisor';
  else if (associatedSameRootRecords.length > 1) reason = 'legacy_ambiguous_same_root_supervisors';
  else if (associatedSameRootRecords.length === 1 && stateDirRecords.length === 0) reason = 'legacy_state_dir_ownership_unproven';
  else if (pidIsOtherLiveProcess) reason = 'legacy_pid_reused_by_other_process';
  else if (lockLive && !lockIsCandidate) reason = 'legacy_live_lock_owner_unproven';
  else if (pidError || (pidFilePresent && pid === null)) reason = 'legacy_pid_unreadable';
  else if (candidate && !candidateStartTime) reason = 'legacy_supervisor_start_time_unreadable';
  else if (candidate && !candidateIsStrictlyConfirmed) reason = 'legacy_supervisor_identity_mismatch';
  else if (!candidate && lockLive) reason = 'legacy_live_lock_owner_unproven';
  else if (!candidate) reason = 'legacy_no_live_supervisor';

  return {
    ok: true,
    migration_needed: true,
    reason,
    status,
    pid,
    pid_live: pidLive,
    pid_command: pidCommand,
    pid_start_time: pidStartTime,
    pid_error: pidError?.message ?? null,
    pid_file_present: pidFilePresent,
    owner_present: Boolean(owner),
    owner_error: ownerError?.message ?? null,
    lock_pid: lockPid,
    lock_live: lockLive,
    live_supervisors: liveRecords,
    same_root_supervisors: sameRootRecords,
    associated_same_root_supervisors: associatedSameRootRecords,
    state_dir_supervisors: stateDirRecords,
    foreign_state_dir_supervisors: foreignStateDirRecords,
    foreign_root_state_dir_supervisors: foreignRootStateDirRecords,
    associated_foreign_state_dir_supervisors: associatedForeignStateDirRecords,
    foreign_supervisors: foreignRecords,
    associated_foreign_supervisors: associatedForeignRecords,
    candidate: candidate ? { ...candidate, start_time: candidateStartTime } : null,
    candidate_confirmed: candidateIsStrictlyConfirmed,
    ownership
  };
}

function sleepMilliseconds(milliseconds) {
  if (milliseconds <= 0) return;
  const shared = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(shared), 0, 0, milliseconds);
}

function supervisorDescendantPids(pid) {
  let output = '';
  try {
    output = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
  } catch {
    return [];
  }
  const children = new Map();
  for (const line of output.split('\n')) {
    const [child, parent] = line.trim().split(/\s+/u);
    if (!child || !parent) continue;
    const list = children.get(parent) || [];
    list.push(Number.parseInt(child, 10));
    children.set(parent, list);
  }
  const descendants = [];
  const stack = [...(children.get(String(pid)) || [])];
  while (stack.length > 0) {
    const child = stack.pop();
    if (!Number.isInteger(child) || descendants.includes(child)) continue;
    descendants.push(child);
    stack.push(...(children.get(String(child)) || []));
  }
  return descendants;
}

export function quiesceLegacySupervisor({
  candidate,
  processExists = (pid) => processIsAlive(pid),
  getProcessStartTime = processStartTime,
  listDescendants = null,
  killProcess = process.kill
}) {
  const descendantLister = listDescendants || ((pid) => supervisorDescendantPids(pid));
  const managed = new Map([[candidate.pid, { pid: candidate.pid, start_time: candidate.start_time }]]);
  for (const pid of descendantLister(candidate.pid)) {
    if (Number.isInteger(pid) && pid > 1 && processExists(pid)) {
      managed.set(pid, { pid, start_time: getProcessStartTime(pid) });
    }
  }
  const stopped = new Map();
  const resumeStopped = () => {
    let failure = null;
    for (const identity of [...stopped.values()].reverse()) {
      if (!processExists(identity.pid) || !identity.start_time || getProcessStartTime(identity.pid) !== identity.start_time) {
        stopped.delete(identity.pid);
        continue;
      }
      try {
        killProcess(identity.pid, 'SIGCONT');
      } catch (error) {
        if (error?.code !== 'ESRCH' && !failure) {
          failure = { ok: false, code: 'legacy_supervisor_resume_signal_failed', pid: identity.pid, error: error.message };
        }
      }
      stopped.delete(identity.pid);
    }
    return failure || { ok: true };
  };
  const stop = () => {
    for (const identity of managed.values()) {
      if (!processExists(identity.pid)
        || !identity.start_time
        || getProcessStartTime(identity.pid) !== identity.start_time) {
        resumeStopped();
        return { ok: false, code: 'legacy_process_identity_changed', pid: identity.pid };
      }
      try {
        killProcess(identity.pid, 0);
      } catch (error) {
        if (error?.code === 'ESRCH') continue;
        resumeStopped();
        return { ok: false, code: 'legacy_supervisor_quiesce_signal_failed', pid: identity.pid, error: error.message };
      }
      try {
        killProcess(identity.pid, 'SIGSTOP');
        stopped.set(identity.pid, identity);
      } catch (error) {
        if (error?.code !== 'ESRCH') {
          resumeStopped();
          return { ok: false, code: 'legacy_supervisor_quiesce_signal_failed', pid: identity.pid, error: error.message };
        }
      }
    }
    return { ok: true };
  };
  const stopResult = stop();
  if (!stopResult.ok) return stopResult;
  return {
    ok: true,
    resume: resumeStopped
  };
}

export function terminateLegacySupervisor({
  candidate,
  processExists = (pid) => processIsAlive(pid),
  getProcessStartTime = processStartTime,
  listDescendants = null,
  killProcess = process.kill,
  sleep = null
}) {
  const descendantLister = listDescendants || ((pid) => supervisorDescendantPids(pid));
  const sleeper = sleep || ((milliseconds) => sleepMilliseconds(milliseconds));
  const managed = new Map([[candidate.pid, { pid: candidate.pid, start_time: candidate.start_time }]]);
  const discover = () => {
    for (const pid of descendantLister(candidate.pid)) {
      if (!managed.has(pid)) {
        const start_time = getProcessStartTime(pid);
        if (!processExists(pid)) continue;
        managed.set(pid, { pid, start_time });
      }
    }
    for (const identity of managed.values()) {
      if (!processExists(identity.pid)) continue;
      if (!identity.start_time) return { ok: false, code: 'legacy_process_identity_unreadable', pid: identity.pid };
      if (getProcessStartTime(identity.pid) !== identity.start_time) {
        return { ok: false, code: 'legacy_process_identity_changed', pid: identity.pid };
      }
    }
    return { ok: true };
  };
  const sendSignal = (signal) => {
    const discovery = discover();
    if (!discovery.ok) return discovery;
    for (const identity of managed.values()) {
      if (!processExists(identity.pid)) continue;
      if (getProcessStartTime(identity.pid) !== identity.start_time) {
        return { ok: false, code: 'legacy_process_identity_changed', pid: identity.pid };
      }
      try { killProcess(identity.pid, signal); } catch (error) {
        if (error?.code !== 'ESRCH') return { ok: false, code: signal === 'SIGKILL' ? 'legacy_stop_force_signal_failed' : 'legacy_stop_signal_failed', error: error.message };
      }
    }
    return { ok: true };
  };
  const initial = discover();
  if (!initial.ok) return initial;
  const term = sendSignal('SIGTERM');
  if (!term.ok) return term;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const discovery = discover();
    if (!discovery.ok) return discovery;
    if (![...managed.values()].some((identity) => processExists(identity.pid))) return { ok: true, stopped_pids: [...managed.keys()] };
    sleeper(100);
  }
  const force = sendSignal('SIGKILL');
  if (!force.ok) return force;
  sleeper(100);
  const final = discover();
  if (!final.ok) return final;
  return [...managed.values()].some((identity) => processExists(identity.pid))
    ? { ok: false, code: 'legacy_supervisor_stop_timeout', stopped_pids: [...managed.keys()] }
    : { ok: true, stopped_pids: [...managed.keys()], forced: true };
}

function removeLegacyRuntimeFiles(stateDir, { processExists = (pid) => processIsAlive(pid) } = {}) {
  const lockPid = readLockPid(stateDir);
  if (lockPid !== null && processExists(lockPid)) {
    return { ok: false, code: 'legacy_live_lock_during_rebaseline', lock_pid: lockPid };
  }
  for (const target of [
    path.join(stateDir, 'phase-loop.pid'),
    path.join(stateDir, 'phase-loop-owner.json'),
    path.join(stateDir, 'stop'),
    path.join(stateDir, 'phase-loop.lock')
  ]) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  return { ok: true };
}

export function migrateLegacyPhaseLoopState({
  stateDir,
  pidFile = path.join(stateDir, 'phase-loop.pid'),
  ownerFile = path.join(stateDir, 'phase-loop-owner.json'),
  rootDir = '',
  now = new Date().toISOString(),
  processExists = (pid) => processIsAlive(pid),
  getProcessCommand = processCommand,
  getProcessStartTime = processStartTime,
  listAllSupervisors = allSupervisorProcessRecords,
  archiveSnapshot = null,
  quiesceSupervisor = null,
  stopSupervisor = null,
  stateSnapshotReader = stateSnapshot,
  statusWriter = writeJsonAtomically,
  runtimeCleaner = null
}) {
  const archiveWriter = archiveSnapshot || ((args) => archiveLegacyStateAtomically(args));
  const quiesceOwner = quiesceSupervisor || ((args) => quiesceLegacySupervisor(args));
  const stopOwner = stopSupervisor || ((args) => terminateLegacySupervisor(args));
  const cleanRuntime = runtimeCleaner || ((directory, options) => removeLegacyRuntimeFiles(directory, options));
  const inspected = inspectLegacyPhaseLoopState({
    stateDir,
    pidFile,
    ownerFile,
    rootDir,
    processExists,
    getProcessCommand,
    getProcessStartTime,
    listAllSupervisors
  });
  if (!inspected.ok || !inspected.migration_needed) return inspected;
  const reusableArchive = reusableLegacyBlockedArchive({ stateDir, inspected, stateSnapshotReader });
  if (reusableArchive) return reusableArchive;
  const recoveryId = crypto.randomUUID();
  let quiescedOwner = null;
  const releaseQuiescedOwner = () => {
    if (!quiescedOwner) return { ok: true };
    const result = typeof quiescedOwner.resume === 'function' ? quiescedOwner.resume() : { ok: true };
    quiescedOwner = null;
    return result?.ok === false ? result : { ok: true };
  };
  if (inspected.candidate_confirmed) {
    try {
      quiescedOwner = quiesceOwner({ candidate: inspected.candidate, processExists, getProcessStartTime });
    } catch (error) {
      return { ok: false, blocked: true, code: 'legacy_supervisor_quiesce_failed', recovery_id: recoveryId, error: error.message };
    }
    if (!quiescedOwner?.ok) {
      return { ok: false, blocked: true, code: quiescedOwner?.code || 'legacy_supervisor_quiesce_failed', recovery_id: recoveryId, quiesce: quiescedOwner };
    }
  }
  let archive;
  try {
    archive = archiveWriter({ stateDir, recoveryId, reason: inspected.reason, now });
  } catch (error) {
    releaseQuiescedOwner();
    return { ok: false, blocked: true, code: 'legacy_state_archive_failed', recovery_id: recoveryId, error: error.message };
  }
  const archivedSnapshot = stateSnapshotReader(stateDir);
  if (archivedSnapshot.fingerprint !== archive.fingerprint) {
    releaseQuiescedOwner();
    return { ok: false, blocked: true, code: 'legacy_state_archive_snapshot_mismatch', recovery_id: recoveryId, archive_path: archive.archive_path };
  }

  const rechecked = inspectLegacyPhaseLoopState({
    stateDir,
    pidFile,
    ownerFile,
    rootDir,
    processExists,
    getProcessCommand,
    getProcessStartTime,
    listAllSupervisors
  });
  if (!rechecked.ok || rechecked.reason !== inspected.reason || stateSnapshotReader(stateDir).fingerprint !== archive.fingerprint) {
    releaseQuiescedOwner();
    return { ok: false, blocked: true, code: 'legacy_state_changed_during_migration', recovery_id: recoveryId, archive_path: archive.archive_path, inspection: rechecked };
  }

  if (rechecked.candidate_confirmed) {
    if (rechecked.candidate?.pid !== inspected.candidate?.pid
      || rechecked.candidate?.start_time !== inspected.candidate?.start_time
      || rechecked.candidate?.command !== inspected.candidate?.command) {
      releaseQuiescedOwner();
      return { ok: false, blocked: true, code: 'legacy_supervisor_identity_race', recovery_id: recoveryId, archive_path: archive.archive_path, inspection: rechecked };
    }
    const releaseResult = releaseQuiescedOwner();
    if (!releaseResult.ok) {
      return { ok: false, blocked: true, code: releaseResult.code || 'legacy_supervisor_resume_failed', recovery_id: recoveryId, archive_path: archive.archive_path, resume: releaseResult };
    }
    const stopResult = stopOwner({ candidate: rechecked.candidate, processExists });
    if (!stopResult?.ok) {
      return { ok: false, blocked: true, code: stopResult?.code || 'legacy_supervisor_stop_failed', recovery_id: recoveryId, archive_path: archive.archive_path, stop: stopResult };
    }
    const afterStop = inspectLegacyPhaseLoopState({
      stateDir,
      pidFile,
      ownerFile,
      rootDir,
      processExists,
      getProcessCommand,
      getProcessStartTime,
      listAllSupervisors
    });
    if (!afterStop.ok
      || afterStop.associated_same_root_supervisors?.length > 0
      || afterStop.associated_foreign_supervisors?.length > 0
      || afterStop.associated_foreign_state_dir_supervisors?.length > 0
      || !sameStateFiles(stateSnapshotReader(stateDir), archive, LEGACY_STOP_ALLOWED_STATE_PATHS)) {
      return { ok: false, blocked: true, code: 'legacy_supervisor_stop_race', recovery_id: recoveryId, archive_path: archive.archive_path, inspection: afterStop };
    }
  } else if (rechecked.reason !== 'legacy_no_live_supervisor') {
    const releaseResult = releaseQuiescedOwner();
    if (!releaseResult.ok) {
      return { ok: false, blocked: true, code: releaseResult.code || 'legacy_supervisor_resume_failed', recovery_id: recoveryId, archive_path: archive.archive_path, resume: releaseResult };
    }
    const blockedStatus = {
      ...rechecked.status,
      status: 'blocked',
      detail: `Legacy phase-loop state migration is blocked because supervisor ownership could not be proven: ${rechecked.reason}. recovery_id=${recoveryId}`,
      exit_code: '75',
      stop_class: 'recoverable_unknown_nonterminal',
      stop_reason: 'legacy_state_ownership_unproven',
      recovery_id: recoveryId,
      recovery_audit: archive.manifest_path,
      updated_at: now
    };
    if (stateSnapshotReader(stateDir).fingerprint !== archive.fingerprint) {
      return { ok: false, blocked: true, code: 'legacy_state_changed_before_block', recovery_id: recoveryId, archive_path: archive.archive_path };
    }
    try {
      statusWriter(path.join(stateDir, 'status.json'), blockedStatus);
    } catch (error) {
      return { ok: false, blocked: true, code: 'legacy_blocked_status_write_failed', recovery_id: recoveryId, archive_path: archive.archive_path, error: error.message };
    }
    return { ok: false, blocked: true, code: 'legacy_state_ownership_unproven', recovery_id: recoveryId, archive_path: archive.archive_path, status: blockedStatus, inspection: rechecked };
  }

  const currentBeforeRebaseline = stateSnapshotReader(stateDir);
  if (!sameStateFiles(currentBeforeRebaseline, archive, new Set(['status.json', ...LEGACY_STOP_ALLOWED_STATE_PATHS]))) {
    return { ok: false, blocked: true, code: 'legacy_state_dirty_before_rebaseline', recovery_id: recoveryId, archive_path: archive.archive_path };
  }
  const rebaselinedStatus = {
    ...rechecked.status,
    status: 'recovered_legacy_state',
    detail: `Archived and rebaselined legacy phase-loop state; safe for one fresh supervisor. recovery_id=${recoveryId}`,
    exit_code: '78',
    continuation_required: false,
    controller_action: 'stop',
    stop_class: 'recoverable_unknown_nonterminal',
    stop_reason: 'legacy_state_rebaselined',
    recovery_id: recoveryId,
    recovery_audit: archive.manifest_path,
    updated_at: now
  };
  try {
    const cleanup = cleanRuntime(stateDir, { processExists });
    if (!cleanup?.ok) return { ok: false, blocked: true, code: cleanup.code || 'legacy_rebaseline_cleanup_failed', recovery_id: recoveryId, archive_path: archive.archive_path, cleanup };
    statusWriter(path.join(stateDir, 'status.json'), rebaselinedStatus);
  } catch (error) {
    return { ok: false, blocked: true, code: 'legacy_rebaseline_failed', recovery_id: recoveryId, archive_path: archive.archive_path, error: error.message };
  }
  return {
    ok: true,
    migrated: true,
    recovery_id: recoveryId,
    archive_path: archive.archive_path,
    status: rebaselinedStatus,
    stopped_legacy_pid: rechecked.candidate?.pid ?? null
  };
}

export function normalizeStaleRunningStatus({
  stateDir,
  pidFile = path.join(stateDir, 'phase-loop.pid'),
  runStamp,
  ownerPid = null,
  ownerGeneration = null,
  ownerFile = path.join(stateDir, 'phase-loop-owner.json'),
  rootDir = '',
  now = new Date().toISOString(),
  processExists = (pid) => processIsAlive(pid),
  getProcessCommand = processCommand,
  listSupervisors = () => liveSupervisorPids(rootDir)
}) {
  const statusPath = path.join(stateDir, 'status.json');
  const auditPath = path.join(stateDir, 'run-state-recovery.jsonl');
  const status = readJson(statusPath);
  if (!status) return { ok: true, normalized: false, reason: 'status_missing' };
  if (status.status !== 'running') return { ok: true, normalized: false, reason: 'status_not_running', status: status.status };

  const referencedPidFile = status.pid_file || pidFile;
  let pid = null;
  try {
    pid = readPid(referencedPidFile);
  } catch (error) {
    if (error?.code !== 'ENOENT') return { ok: false, code: 'pid_read_failed', error: error.message };
  }
  const ownership = inspectSupervisorOwnership({
    stateDir,
    pidFile: referencedPidFile,
    ownerFile,
    rootDir,
    ownerPid,
    ownerGeneration,
    processExists,
    getProcessCommand,
    listSupervisors
  });
  if (ownership.ownership_ok) {
    if (
      status.continuation_required === true
      && status.controller_action === 'resume'
    ) {
      return { ok: true, normalized: false, reason: 'owned_continuation_resume', pid, run_id: status.run_id ?? null, generation: ownership.owner.generation };
    }
    return { ok: false, code: 'run_already_running', pid, run_id: status.run_id ?? null };
  }
  if (ownership.live_supervisors.length > 0 || ownership.live_pid) {
    return {
      ok: false,
      code: 'supervisor_ownership_conflict',
      pid,
      run_id: status.run_id ?? null,
      status_pid: status.supervisor_pid ?? null,
      status_generation: status.supervisor_generation ?? null,
      owner_pid: ownership.owner?.pid ?? null,
      owner_generation: ownership.owner?.generation ?? null,
      live_supervisors: ownership.live_supervisors
    };
  }

  const recoveryId = crypto.randomUUID();
  const previous = { ...status };
  const prepared = {
    schema_version: 1,
    kind: 'phase_loop_run_state_recovery',
    recovery_id: recoveryId,
    phase: 'prepared',
    reason: 'stale_running_pid_missing',
    previous_status: previous,
    pid,
    requested_run_stamp: runStamp ?? null,
    at: now
  };
  try {
    appendJsonLine(auditPath, prepared);
    const replacement = {
      ...status,
      status: 'recovered_stale_running',
      detail: `Recovered stale running status for run_id=${status.run_id ?? '<none>'}; no live phase-loop pid was found. recovery_id=${recoveryId}`,
      exit_code: '78',
      consecutive_failures: Math.max(Number(status.consecutive_failures ?? 0) + 1, 1),
      updated_at: now,
      recovery_id: recoveryId,
      recovery_audit: auditPath
    };
    writeJsonAtomically(statusPath, replacement);
    appendJsonLine(auditPath, { ...prepared, phase: 'applied', replacement_status: replacement, applied_at: now });
    return { ok: true, normalized: true, recovery_id: recoveryId, previous_status: previous, replacement_status: replacement };
  } catch (error) {
    return { ok: false, code: 'stale_running_recovery_failed', recovery_id: recoveryId, error: error.message };
  }
}

// Recovery is deliberately reversible for audit and operator correction. The
// guard prevents an old recovery record from restoring a newer status.
export function rollbackStaleRunningRecovery({ stateDir, recoveryId, now = new Date().toISOString() }) {
  const statusPath = path.join(stateDir, 'status.json');
  const auditPath = path.join(stateDir, 'run-state-recovery.jsonl');
  const status = readJson(statusPath);
  if (!status) return { ok: false, code: 'status_missing' };
  if (status.status !== 'recovered_stale_running' || status.recovery_id !== recoveryId) {
    return { ok: false, code: 'recovery_not_current' };
  }
  const applied = readJsonLines(auditPath).find((record) => (
    record?.phase === 'applied' && record?.recovery_id === recoveryId && record?.previous_status
  ));
  if (!applied) return { ok: false, code: 'recovery_audit_missing' };
  const restored = {
    ...applied.previous_status,
    recovery_rollback_id: recoveryId,
    recovery_rolled_back_at: now
  };
  try {
    writeJsonAtomically(statusPath, restored);
    appendJsonLine(auditPath, {
      schema_version: 1,
      kind: 'phase_loop_run_state_recovery',
      recovery_id: recoveryId,
      phase: 'rolled_back',
      restored_status: restored,
      at: now
    });
  } catch (error) {
    return { ok: false, code: 'recovery_rollback_failed', error: error.message };
  }
  return { ok: true, rolled_back: true, restored_status: restored };
}

export function watchdogContinuationLiveness({
  stateDir,
  pidFile = path.join(stateDir, 'phase-loop.pid'),
  ownerFile = path.join(stateDir, 'phase-loop-owner.json'),
  rootDir = '',
  maxAgeSeconds = 900,
  now = new Date().toISOString(),
  runStamp = null,
  processExists = (pid) => processIsAlive(pid),
  getProcessCommand = processCommand,
  listSupervisors = () => liveSupervisorPids(rootDir)
}) {
  const statusPath = path.join(stateDir, 'status.json');
  const auditPath = path.join(stateDir, 'run-state-recovery.jsonl');
  const status = readJson(statusPath);
  if (!status || status.continuation_required !== true || status.controller_action !== 'resume') {
    return { ok: true, expired: false, reason: 'continuation_not_pending' };
  }
  const normalizedMaxAgeSeconds = Number(maxAgeSeconds);
  if (!Number.isFinite(normalizedMaxAgeSeconds) || !Number.isInteger(normalizedMaxAgeSeconds) || normalizedMaxAgeSeconds <= 0) {
    return {
      ok: false,
      code: 'continuation_watchdog_duration_invalid',
      max_age_seconds: maxAgeSeconds,
      run_id: status.run_id ?? null
    };
  }
  const ownership = inspectSupervisorOwnership({
    stateDir,
    pidFile,
    ownerFile,
    rootDir,
    processExists,
    getProcessCommand,
    listSupervisors
  });
  if (!ownership.matching_owner
    || (ownership.live_pid && !ownership.command_looks_like_supervisor)
    || ownership.live_supervisors.some((pid) => pid !== ownership.pid)) {
    return {
      ok: false,
      code: 'continuation_ownership_unproven',
      run_id: status.run_id ?? null,
      live_supervisors: ownership.live_supervisors,
      pid: ownership.pid,
      status_generation: status.supervisor_generation ?? null,
      owner_generation: ownership.owner?.generation ?? null
    };
  }
  const updatedAt = Date.parse(status.updated_at || '');
  const nowMs = Date.parse(now);
  if (!Number.isFinite(updatedAt) || !Number.isFinite(nowMs)) {
    return { ok: false, code: 'continuation_timestamp_invalid', run_id: status.run_id ?? null };
  }
  const ageSeconds = Math.max(0, Math.floor((nowMs - updatedAt) / 1000));
  if (ageSeconds < normalizedMaxAgeSeconds) {
    return { ok: true, expired: false, age_seconds: ageSeconds, reason: 'continuation_within_deadline' };
  }
  const currentStatus = readJson(statusPath);
  if (continuationVersion(currentStatus) !== continuationVersion(status)) {
    return {
      ok: true,
      expired: false,
      reason: 'continuation_changed_during_watchdog_check',
      run_id: currentStatus?.run_id ?? null
    };
  }
  const recoveryId = crypto.randomUUID();
  const previous = { ...currentStatus };
  const replacement = {
    ...currentStatus,
    status: 'blocked',
    detail: `Continuation resume watchdog expired after ${ageSeconds}s; terminalized for audited redelegation. recovery_id=${recoveryId}`,
    exit_code: '78',
    continuation_required: false,
    controller_action: 'stop',
    stop_class: 'terminal_failure',
    stop_reason: 'continuation_watchdog_expired',
    recovery_id: recoveryId,
    recovery_audit: auditPath,
    updated_at: now
  };
  const prepared = {
    schema_version: 1,
    kind: 'phase_loop_continuation_watchdog',
    recovery_id: recoveryId,
    phase: 'prepared',
    reason: 'continuation_watchdog_expired',
    previous_status: previous,
    replacement_status: replacement,
    age_seconds: ageSeconds,
    requested_run_stamp: runStamp,
    at: now
  };
  try {
    appendJsonLine(auditPath, prepared);
    writeJsonAtomically(statusPath, replacement);
    appendJsonLine(auditPath, { ...prepared, phase: 'applied', applied_at: now });
  } catch (error) {
    return { ok: false, code: 'continuation_watchdog_apply_failed', recovery_id: recoveryId, error: error.message };
  }
  return { ok: true, expired: true, redelegate: true, recovery_id: recoveryId, age_seconds: ageSeconds, owner_pid: ownership.pid, run_id: status.run_id ?? null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname) && ['normalize-stale-running', 'rollback-stale-running', 'watch-continuation', 'migrate-legacy-state'].includes(process.argv[2])) {
  const args = new Map(process.argv.slice(3).reduce((pairs, value, index, values) => (
    value.startsWith('--') ? [...pairs, [value.slice(2), values[index + 1]]] : pairs
  ), []));
  const stateDir = args.get('state-dir');
  if (!stateDir) process.exit(2);
  const result = process.argv[2] === 'rollback-stale-running'
    ? rollbackStaleRunningRecovery({ stateDir, recoveryId: args.get('recovery-id') })
    : process.argv[2] === 'watch-continuation'
      ? watchdogContinuationLiveness({
        stateDir,
        pidFile: args.get('pid-file') || path.join(stateDir, 'phase-loop.pid'),
        ownerFile: args.get('owner-file') || path.join(stateDir, 'phase-loop-owner.json'),
        rootDir: args.get('root-dir') || '',
        maxAgeSeconds: Number.parseInt(args.get('max-age-seconds') || '900', 10),
        runStamp: args.get('run-stamp')
      })
      : process.argv[2] === 'migrate-legacy-state'
        ? migrateLegacyPhaseLoopState({
          stateDir,
          pidFile: args.get('pid-file') || path.join(stateDir, 'phase-loop.pid'),
          ownerFile: args.get('owner-file') || path.join(stateDir, 'phase-loop-owner.json'),
          rootDir: args.get('root-dir') || ''
        })
        : normalizeStaleRunningStatus({
      stateDir,
      pidFile: args.get('pid-file') || path.join(stateDir, 'phase-loop.pid'),
      ownerPid: args.has('owner-pid') ? Number.parseInt(args.get('owner-pid'), 10) : null,
      ownerGeneration: args.get('owner-generation') || null,
      ownerFile: args.get('owner-file') || path.join(stateDir, 'phase-loop-owner.json'),
      rootDir: args.get('root-dir') || '',
      runStamp: args.get('run-stamp')
    });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exit(result.code === 'run_already_running'
    || result.code === 'supervisor_ownership_conflict'
    || result.code === 'continuation_ownership_unproven'
    || result.code === 'legacy_state_ownership_unproven'
    || result.code === 'legacy_foreign_supervisor'
    || result.code === 'legacy_ambiguous_same_root_supervisors'
    || result.code === 'legacy_pid_reused_by_other_process'
    || result.code === 'legacy_state_changed_during_migration'
    || result.code === 'legacy_state_changed_before_block'
    || result.blocked
      ? 75
      : 78);
}
