import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const soakObjective = 'Create one bounded stateful soak marker in the workspace.';
const maximumCommands = 3;

const releaseTargets = [
  { id: 'linux-x64', archiveName: 'brownie-linux-x64.tar.gz', archiveType: 'tar', binaryName: 'brownie', runtimeName: 'brownie-runtime' },
  { id: 'darwin-arm64', archiveName: 'brownie-darwin-arm64.tar.gz', archiveType: 'tar', binaryName: 'brownie', runtimeName: 'brownie-runtime' },
  { id: 'win32-x64', archiveName: 'brownie-win32-x64.zip', archiveType: 'zip', binaryName: 'brownie.exe', runtimeName: 'brownie-runtime.exe' }
];

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function sha256Value(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout ?? 60_000
  });
  if (result.error) throw result.error;
  return result;
}

function findFile(root, fileName) {
  if (!root || !fs.existsSync(root)) return null;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name === fileName) return candidate;
    if (entry.isDirectory()) {
      const found = findFile(candidate, fileName);
      if (found) return found;
    }
  }
  return null;
}

function extractArchive(target, archivePath, extractionRoot) {
  const result = target.archiveType === 'tar'
    ? run('tar', ['-xzf', archivePath, '-C', extractionRoot])
    : process.platform === 'win32'
      ? run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${archivePath.replaceAll("'", "''")}' -DestinationPath '${extractionRoot.replaceAll("'", "''")}' -Force`])
      : run('unzip', ['-q', archivePath, '-d', extractionRoot]);
  if (result.status !== 0) throw new Error(`could not extract ${target.archiveName}: ${result.stderr || result.stdout}`);
}

function parseChecksums(filePath) {
  const checksums = {};
  for (const line of fs.readFileSync(filePath, 'utf8').trim().split('\n')) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/u);
    if (!match) throw new Error(`invalid SHA256SUMS line: ${line}`);
    checksums[match[2]] = `sha256:${match[1]}`;
  }
  return checksums;
}

function assertPackageIntegrity(target, extractionRoot) {
  const artifactEvidencePath = path.join(extractionRoot, 'artifact-evidence.json');
  const checksumsPath = path.join(extractionRoot, 'SHA256SUMS');
  if (!fs.existsSync(artifactEvidencePath) || !fs.existsSync(checksumsPath)) {
    throw new Error('extracted artifact is missing signed package evidence');
  }
  const artifactEvidence = JSON.parse(fs.readFileSync(artifactEvidencePath, 'utf8'));
  const checksums = parseChecksums(checksumsPath);
  for (const [field, name] of [['artifact', target.binaryName], ['runtime_companion', target.runtimeName]]) {
    const filePath = path.join(extractionRoot, name);
    const digest = sha256File(filePath);
    if (!fs.existsSync(filePath) || artifactEvidence?.[field]?.path !== name || artifactEvidence?.[field]?.sha256 !== digest || checksums[name] !== digest) {
      throw new Error(`package integrity mismatch for ${name}`);
    }
  }
  if (artifactEvidence.target !== target.id) throw new Error(`artifact target mismatch: expected ${target.id}`);
  return { artifact_sha256: artifactEvidence.artifact.sha256, runtime_sha256: artifactEvidence.runtime_companion.sha256 };
}

function runJson(binaryPath, args, environment) {
  const result = run(binaryPath, ['--json', ...args], { env: environment });
  if (result.status !== 0) throw new Error(`packaged CLI ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`packaged CLI ${args.join(' ')} did not return JSON: ${error.message}`);
  }
}

function stableWorkspaceSnapshot(workspaceRoot) {
  const rows = [];
  const visit = (current, relative = '') => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) visit(child, childRelative);
      else if (entry.isFile()) rows.push(`${childRelative}:${sha256File(child)}`);
      else if (entry.isSymbolicLink()) rows.push(`${childRelative}:symlink:${fs.readlinkSync(child)}`);
      else throw new Error(`workspace snapshot does not support ${childRelative}`);
    }
  };
  visit(workspaceRoot);
  return sha256Value(rows.join('\n'));
}

function readDurableLedger(ledgerPath) {
  const contents = fs.readFileSync(ledgerPath, 'utf8');
  const lines = contents.trim().split('\n');
  if (lines.length === 0 || (lines.length === 1 && lines[0].length === 0)) {
    throw new Error('durable ledger is empty');
  }
  let events;
  try {
    events = lines.map((line) => JSON.parse(line));
  } catch (error) {
    throw new Error(`durable ledger is not valid JSONL: ${error.message}`);
  }
  if (events.some((event) => !event || typeof event !== 'object' || Array.isArray(event))) {
    throw new Error('durable ledger contains a non-object event');
  }
  return { contents, events, sha256: sha256Value(contents) };
}

function hasHeadlessJourneyStartedEvent(ledger) {
  return ledger.events.some((event) => {
    const kind = String(event.kind ?? event.event ?? '').replaceAll(/[^a-z0-9]/giu, '').toLowerCase();
    return kind === 'headlessjourneystarted';
  });
}

function discoverInterruptedRun(workspaceRoot) {
  const runsRoot = path.join(workspaceRoot, '.brownie', 'runs');
  if (!fs.existsSync(runsRoot)) throw new Error('process loss did not create a durable runs directory');
  const candidates = fs.readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ runId: entry.name, ledgerPath: path.join(runsRoot, entry.name, 'ledger.jsonl') }))
    .filter((candidate) => fs.existsSync(candidate.ledgerPath))
    .sort((left, right) => left.runId.localeCompare(right.runId));
  if (candidates.length !== 1) {
    throw new Error(`process loss produced ${candidates.length} durable run ledgers; expected exactly one`);
  }
  return candidates[0];
}

function assertLedgerPreserved(beforeRecovery, afterRecovery) {
  if (!afterRecovery.contents.startsWith(beforeRecovery.contents)) {
    throw new Error('process-loss recovery did not preserve the durable ledger prefix');
  }
  if (afterRecovery.events.length < beforeRecovery.events.length) {
    throw new Error('process-loss recovery truncated durable ledger events');
  }
}

function requireObject(value, description) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${description} is missing`);
  return value;
}

function evidencePathFrom(options) {
  return options.evidencePath ?? process.env.BROWNIE_RELEASE_ARTIFACT_SOAK_EVIDENCE_PATH ?? '';
}

export function runReleaseArtifactStatefulSoak(options = {}) {
  const targetId = options.targetId ?? process.env.BROWNIE_RELEASE_ARTIFACT_SOAK_TARGET ?? '';
  const target = releaseTargets.find((candidate) => candidate.id === targetId);
  if (!target) throw new Error(`unsupported release artifact soak target: ${targetId || '<missing>'}`);
  const downloadRoot = options.downloadRoot ?? process.env.BROWNIE_RELEASE_ARTIFACT_SOAK_DOWNLOAD_ROOT ?? '';
  const archivePath = options.archivePath ?? findFile(downloadRoot, target.archiveName);
  if (!archivePath) throw new Error(`downloaded ${target.archiveName} was not found`);

  const extractionRoot = fs.mkdtempSync(path.join(os.tmpdir(), `brownie-release-artifact-soak-${target.id}-`));
  extractArchive(target, archivePath, extractionRoot);
  const packageIntegrity = assertPackageIntegrity(target, extractionRoot);
  const packagedCli = path.join(extractionRoot, target.binaryName);
  if (!fs.existsSync(packagedCli)) throw new Error(`packaged CLI ${target.binaryName} is missing`);
  if (process.platform !== 'win32') fs.accessSync(packagedCli, fs.constants.X_OK);

  const workspaceRoot = options.workspaceRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), `brownie-release-artifact-soak-workspace-${target.id}-`));
  const environment = { ...process.env, ...(options.env ?? {}), BROWNIE_WORKSPACE_ROOT: workspaceRoot };
  delete environment.BROWNIE_RUNTIME_PATH;
  const beforeRun = stableWorkspaceSnapshot(workspaceRoot);
  const modeList = runJson(packagedCli, ['mode', 'list'], environment);
  if (!Array.isArray(modeList?.mode_list?.modes) || modeList.mode_list.modes.length === 0) {
    throw new Error('packaged CLI did not load a Mode Pack');
  }

  // Each state transition below is a fresh executable process. The initial
  // process exits only after the runtime has durably recorded a journey start;
  // resume and replay must therefore recover persisted state, never an
  // in-memory retry.
  const interruptionEnvironment = {
    ...environment,
    BROWNIE_RELEASE_ARTIFACT_SOAK_PROCESS_LOSS_AFTER_JOURNEY_STARTED: '1'
  };
  const interrupted = run(packagedCli, ['--json', 'run', soakObjective], { env: interruptionEnvironment });
  if (interrupted.status === 0) throw new Error('runtime run did not lose its process after the durable journey boundary');
  const interruptedRun = discoverInterruptedRun(workspaceRoot);
  const ledgerPath = interruptedRun.ledgerPath;
  const ledgerAfterRun = readDurableLedger(ledgerPath);
  if (!hasHeadlessJourneyStartedEvent(ledgerAfterRun)) {
    throw new Error('process loss occurred before the durable HeadlessJourneyStarted ledger boundary');
  }
  const afterRun = stableWorkspaceSnapshot(workspaceRoot);
  if (afterRun === beforeRun) throw new Error('runtime run did not make a durable workspace mutation');

  const resumed = requireObject(runJson(packagedCli, ['resume'], environment).resume, 'runtime process-loss recovery result');
  if (resumed.status !== 'no_eligible_task' || resumed.controller_action !== 'resume' || resumed.continuation_required !== true) {
    throw new Error('runtime did not expose the expected bounded recovery continuation after process loss');
  }
  const afterRecovery = stableWorkspaceSnapshot(workspaceRoot);
  const ledgerAfterRecovery = readDurableLedger(ledgerPath);
  assertLedgerPreserved(ledgerAfterRun, ledgerAfterRecovery);

  const replay = requireObject(runJson(packagedCli, ['resume'], environment).resume, 'runtime replay result');
  const afterReplay = stableWorkspaceSnapshot(workspaceRoot);
  const ledgerAfterReplay = readDurableLedger(ledgerPath);
  if (replay.status !== 'no_eligible_task' || replay.controller_action !== 'stop' || replay.continuation_required !== false) {
    throw new Error('runtime did not reject replay at the terminal boundary');
  }
  if (afterReplay !== afterRecovery || ledgerAfterReplay.sha256 !== ledgerAfterRecovery.sha256) {
    throw new Error('replay caused a duplicate side effect after terminal convergence');
  }

  const evidence = {
    schema_version: 1,
    evidence_id: 'brownie-release-artifact-stateful-soak-v1',
    target: target.id,
    bounds: { maximum_commands: maximumCommands, commands_executed: maximumCommands, per_command_timeout_ms: 60_000 },
    artifact: { archive_sha256: sha256File(archivePath), ...packageIntegrity },
    checks: {
      process_loss_recovery: { passed: true, fresh_process_resume: true, initial_command_exit_code: interrupted.status, durable_journey_event: true, recovery_status: resumed.status },
      duplicate_side_effect_rejection: { passed: true, replay_status: replay.status, workspace_unchanged: true, ledger_unchanged: true },
      ledger_workspace_consistency: { passed: true, full_workspace_snapshot: true, ledger_prefix_preserved: true, ledger_after_run: ledgerAfterRun.sha256, ledger_after_recovery: ledgerAfterRecovery.sha256, workspace_after_run: afterRun, workspace_after_recovery: afterRecovery },
      resume_replay_behavior: { passed: true, resume_controller_action: resumed.controller_action, replay_controller_action: replay.controller_action },
      finite_convergence: { passed: true, recovery_status: resumed.status, terminal_status: replay.status, commands_executed: maximumCommands, maximum_commands: maximumCommands },
      evidence_chain_integrity: { passed: true, archive_sha256: sha256File(archivePath), artifact_sha256: packageIntegrity.artifact_sha256, runtime_sha256: packageIntegrity.runtime_sha256, workspace_snapshot: afterRecovery, ledger_sha256: ledgerAfterRecovery.sha256 }
    }
  };
  const outputPath = evidencePathFrom(options);
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  return evidence;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(runReleaseArtifactStatefulSoak({ cwd: repoRoot }))}\n`);
}
