import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const journeyObjective = 'Create a bounded journey marker in the workspace.';

const releaseTargets = [
  { id: 'linux-x64', archiveName: 'brownie-linux-x64.tar.gz', archiveType: 'tar', binaryName: 'brownie', runtimeName: 'brownie-runtime' },
  { id: 'darwin-arm64', archiveName: 'brownie-darwin-arm64.tar.gz', archiveType: 'tar', binaryName: 'brownie', runtimeName: 'brownie-runtime' },
  { id: 'win32-x64', archiveName: 'brownie-win32-x64.zip', archiveType: 'zip', binaryName: 'brownie.exe', runtimeName: 'brownie-runtime.exe' },
  { id: 'linux-arm64', archiveName: 'brownie-linux-arm64.tar.gz', archiveType: 'tar', binaryName: 'brownie', runtimeName: 'brownie-runtime' }
];

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
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
  if (result.status !== 0) {
    throw new Error(`could not extract ${target.archiveName}: ${result.stderr || result.stdout}`);
  }
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
    if (!fs.existsSync(filePath)) throw new Error(`extracted artifact is missing ${name}`);
    const digest = sha256File(filePath);
    if (artifactEvidence?.[field]?.path !== name || artifactEvidence?.[field]?.sha256 !== digest || checksums[name] !== digest) {
      throw new Error(`package integrity mismatch for ${name}`);
    }
  }
  if (artifactEvidence.target !== target.id) throw new Error(`artifact target mismatch: expected ${target.id}`);
  return {
    artifact_sha256: artifactEvidence.artifact.sha256,
    runtime_sha256: artifactEvidence.runtime_companion.sha256
  };
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
  const root = path.join(workspaceRoot, '.brownie');
  const rows = [];
  const visit = (current, relative = '') => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) visit(child, childRelative);
      else if (entry.isFile()) rows.push(`${childRelative}:${sha256File(child)}`);
    }
  };
  visit(root);
  return `sha256:${crypto.createHash('sha256').update(rows.join('\n')).digest('hex')}`;
}

function requireObject(value, description) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${description} is missing`);
  return value;
}

function evidencePathFrom(options) {
  return options.evidencePath ?? process.env.BROWNIE_RELEASE_RUNTIME_JOURNEY_EVIDENCE_PATH ?? '';
}

export function runReleaseArtifactRuntimeJourney(options = {}) {
  const targetId = options.targetId ?? process.env.BROWNIE_RELEASE_RUNTIME_JOURNEY_TARGET ?? '';
  const target = releaseTargets.find((candidate) => candidate.id === targetId);
  if (!target) throw new Error(`unsupported release Runtime journey target: ${targetId || '<missing>'}`);
  const downloadRoot = options.downloadRoot ?? process.env.BROWNIE_RELEASE_RUNTIME_JOURNEY_DOWNLOAD_ROOT ?? '';
  const archivePath = options.archivePath ?? findFile(downloadRoot, target.archiveName);
  if (!archivePath) throw new Error(`downloaded ${target.archiveName} was not found`);

  const extractionRoot = fs.mkdtempSync(path.join(os.tmpdir(), `brownie-release-runtime-journey-${target.id}-`));
  extractArchive(target, archivePath, extractionRoot);
  const packageIntegrity = assertPackageIntegrity(target, extractionRoot);
  const packagedCli = path.join(extractionRoot, target.binaryName);
  if (!fs.existsSync(packagedCli)) throw new Error(`packaged CLI ${target.binaryName} is missing`);
  if (process.platform !== 'win32') fs.accessSync(packagedCli, fs.constants.X_OK);

  const workspaceRoot = options.workspaceRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), `brownie-release-runtime-workspace-${target.id}-`));
  const environment = { ...process.env, ...(options.env ?? {}), BROWNIE_WORKSPACE_ROOT: workspaceRoot };
  delete environment.BROWNIE_RUNTIME_PATH;
  const beforeRun = stableWorkspaceSnapshot(workspaceRoot);
  const modeList = runJson(packagedCli, ['mode', 'list'], environment);
  const modes = modeList?.mode_list?.modes;
  if (!Array.isArray(modes) || modes.length === 0) throw new Error('packaged CLI did not load a Mode Pack');

  const runResult = runJson(packagedCli, ['run', journeyObjective], environment);
  const run = requireObject(runResult.run, 'runtime run result');
  const automation = requireObject(run.automation, 'runtime run automation');
  if (automation.controller_action !== 'resume' || automation.continuation_required !== true) {
    throw new Error('runtime run did not record a bounded forced interruption');
  }
  for (const key of ['session_id', 'journey_id', 'task_id', 'run_id']) {
    if (typeof run[key] !== 'string' || run[key].length === 0) throw new Error(`runtime run did not return ${key}`);
  }
  const ledgerPath = path.join(workspaceRoot, '.brownie', 'runs', run.run_id, 'ledger.jsonl');
  if (!fs.existsSync(ledgerPath) || fs.statSync(ledgerPath).size === 0) throw new Error('runtime run did not create a durable ledger');
  const afterRun = stableWorkspaceSnapshot(workspaceRoot);
  if (afterRun === beforeRun) throw new Error('runtime run did not make a durable workspace mutation');

  const resumeArgs = ['resume', '--session-id', run.session_id, '--journey-id', run.journey_id, '--task-id', run.task_id, '--run-id', run.run_id];
  const resumed = runJson(packagedCli, resumeArgs, environment);
  const resumedPayload = requireObject(resumed.resume, 'runtime resume result');
  if (resumedPayload.status !== 'no_eligible_task' || resumedPayload.controller_action !== 'stop') {
    throw new Error('runtime did not safely stop the bounded forced interruption');
  }
  const afterResume = stableWorkspaceSnapshot(workspaceRoot);
  const replay = runJson(packagedCli, resumeArgs, environment);
  const replayPayload = requireObject(replay.resume, 'runtime replay result');
  const afterReplay = stableWorkspaceSnapshot(workspaceRoot);
  if (replayPayload.status !== 'no_eligible_task' || replayPayload.controller_action !== 'stop' || afterReplay !== afterResume) {
    throw new Error('runtime did not reject replay without a side effect');
  }

  const evidence = {
    schema_version: 1,
    evidence_id: 'brownie-release-artifact-runtime-journey-v1',
    target: target.id,
    artifact: {
      archive_sha256: sha256File(archivePath),
      ...packageIntegrity
    },
    checks: {
      mode_pack_load: { passed: true, mode_count: modes.length },
      workspace_mutation: { passed: true, before: beforeRun, after: afterRun },
      ledger_generation: { passed: true, ledger_sha256: sha256File(ledgerPath) },
      forced_interruption: { passed: true, controller_action: automation.controller_action, stop_reason: automation.stop_reason },
      resume: { passed: true, status: resumedPayload.status, controller_action: resumedPayload.controller_action },
      stale_replay_rejection: { passed: true, status: replayPayload.status, controller_action: replayPayload.controller_action, workspace_unchanged: true }
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
  const evidence = runReleaseArtifactRuntimeJourney({ cwd: repoRoot });
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}
