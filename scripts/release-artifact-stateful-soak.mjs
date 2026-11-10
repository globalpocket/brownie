import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixtureEnvironment, withFixtureProvider } from './release-artifact-runtime-journey.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const soakOutputName = 'journey-output.md';
const soakOutput = 'Brownie completed the artifact Runtime journey.\n';
const soakObjective = `Update ${soakOutputName} with exactly: ${soakOutput.trim()} Use the normal proposal, apply and verification path.`;
const maximumCommands = 3;
const processLossExitCode = 75;
const snapshotBudget = Object.freeze({ maximumEntries: 4096, maximumDepth: 64, maximumBytes: 64 * 1024 * 1024 });

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

function boundedCommandLimit(options = {}) {
  const configured = [
    options.maximumCommands,
    process.env.BROWNIE_RELEASE_ARTIFACT_SOAK_MAXIMUM_COMMANDS
  ].filter((value) => value !== undefined && value !== '');
  for (const value of configured) {
    if (!Number.isInteger(Number(value)) || Number(value) !== maximumCommands) {
      throw new Error(`stateful soak maximum command bound must be exactly ${maximumCommands}`);
    }
  }
  return maximumCommands;
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
    throw new Error('extracted artifact is missing package integrity evidence');
  }
  const artifactEvidence = JSON.parse(fs.readFileSync(artifactEvidencePath, 'utf8'));
  const checksums = parseChecksums(checksumsPath);
  for (const [field, name] of [['artifact', target.binaryName], ['runtime_companion', target.runtimeName]]) {
    const filePath = path.join(extractionRoot, name);
    if (fs.lstatSync(filePath).isSymbolicLink()) {
      throw new Error(`package integrity rejects symbolic link for ${name}`);
    }
    const digest = sha256File(filePath);
    if (!fs.existsSync(filePath) || artifactEvidence?.[field]?.path !== name || artifactEvidence?.[field]?.sha256 !== digest || checksums[name] !== digest) {
      throw new Error(`package integrity mismatch for ${name}`);
    }
  }
  if (artifactEvidence.target !== target.id) throw new Error(`artifact target mismatch: expected ${target.id}`);
  return { artifact_sha256: artifactEvidence.artifact.sha256, runtime_sha256: artifactEvidence.runtime_companion.sha256 };
}

function runJson(binaryPath, args, environment, cwd) {
  const result = run(binaryPath, ['--json', ...args], { env: environment, cwd });
  if (result.status !== 0) throw new Error(`packaged CLI ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`packaged CLI ${args.join(' ')} did not return JSON: ${error.message}`);
  }
}

function stableWorkspaceSnapshot(workspaceRoot) {
  const rows = [];
  let entriesVisited = 0;
  let bytesRead = 0;
  const snapshotFile = (filePath, size) => {
    if (bytesRead + size > snapshotBudget.maximumBytes) throw new Error('workspace snapshot byte budget exceeded');
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    const descriptor = fs.openSync(filePath, 'r');
    try {
      let count;
      while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) !== 0) {
        bytesRead += count;
        if (bytesRead > snapshotBudget.maximumBytes) throw new Error('workspace snapshot byte budget exceeded');
        hash.update(buffer.subarray(0, count));
      }
    } finally {
      fs.closeSync(descriptor);
    }
    return `sha256:${hash.digest('hex')}`;
  };
  const visitDirectory = (current, relative, activeDirectories, depth = 0) => {
    if (depth > snapshotBudget.maximumDepth) throw new Error('workspace snapshot depth budget exceeded');
    const canonicalDirectory = fs.realpathSync(current);
    rows.push(`${relative}:directory:${fs.statSync(current).mode & 0o777}`);
    if (activeDirectories.has(canonicalDirectory)) {
      // A symlink can point back to an ancestor.  Keep this stable marker so
      // cycles cannot recurse forever, while the ancestor remains snapshotted.
      rows.push(`${relative}:directory-cycle`);
      return;
    }
    const nextActiveDirectories = new Set(activeDirectories);
    nextActiveDirectories.add(canonicalDirectory);
    // Stream directory enumeration so the bound applies before allocating an
    // unbounded entry array. Sorting stays deterministic within that budget.
    const directory = fs.opendirSync(current);
    const entries = [];
    try {
      let entry;
      while ((entry = directory.readSync()) !== null) {
        entriesVisited += 1;
        if (entriesVisited > snapshotBudget.maximumEntries) throw new Error('workspace snapshot entry budget exceeded');
        entries.push(entry);
      }
    } finally {
      directory.closeSync();
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      visitPath(path.join(current, entry.name), childRelative, nextActiveDirectories, depth + 1);
    }
  };
  const visitPath = (current, relative, activeDirectories, depth) => {
    const metadata = fs.lstatSync(current);
    if (metadata.isDirectory()) {
      visitDirectory(current, relative, activeDirectories, depth);
      return;
    }
    if (metadata.isFile()) {
      rows.push(`${relative}:file:${metadata.mode & 0o777}:${snapshotFile(current, metadata.size)}`);
      return;
    }
    if (!metadata.isSymbolicLink()) throw new Error(`workspace snapshot does not support ${relative}`);

    // The link text alone is insufficient: a replay can mutate a target that
    // lies outside the workspace without altering the link itself. Snapshot
    // all reachable target contents under the link's logical workspace path.
    rows.push(`${relative}:symlink:${fs.readlinkSync(current)}`);
    let targetMetadata;
    try {
      targetMetadata = fs.statSync(current);
    } catch (error) {
      throw new Error(`workspace snapshot cannot resolve symbolic link ${relative}: ${error.message}`);
    }
    if (targetMetadata.isDirectory()) {
      visitDirectory(current, `${relative}:target`, activeDirectories, depth);
    } else if (targetMetadata.isFile()) {
      rows.push(`${relative}:target:file:${targetMetadata.mode & 0o777}:${snapshotFile(current, targetMetadata.size)}`);
    } else {
      throw new Error(`workspace snapshot does not support symbolic link target ${relative}`);
    }
  };
  if (fs.existsSync(workspaceRoot)) visitDirectory(workspaceRoot, '', new Set());
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

function workflowRunIdFrom(options) {
  const candidate = options.workflowRunId ?? process.env.GITHUB_RUN_ID ?? null;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
}

function prepareSoakFixture(workspaceRoot, environment, baseUrl) {
  for (const name of ['.git', '.gitignore', soakOutputName]) {
    if (fs.lstatSync(path.join(workspaceRoot, name), { throwIfNoEntry: false })) throw new Error(`isolated soak fixture path already exists: ${name}`);
  }
  fs.writeFileSync(path.join(workspaceRoot, '.brownie', 'config.json'), JSON.stringify({ version: 1, active_profile: 'artifact-soak-fixture', llm: { profiles: {
    'artifact-soak-fixture': { provider: 'openai-compatible', base_url: baseUrl, model: 'artifact-journey-fixture', api_key_env: 'BROWNIE_TEST_LLM_API_KEY', strict: true }
  } } }));
  fs.writeFileSync(path.join(workspaceRoot, soakOutputName), 'Pending artifact stateful soak.\n');
  fs.writeFileSync(path.join(workspaceRoot, '.gitignore'), '.brownie/\n');
  for (const args of [['init', '-q'], ['add', '--', '.gitignore', soakOutputName],
    ['-c', 'user.name=Brownie Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgSign=false', '-c', `core.hooksPath=${path.join(workspaceRoot, '.brownie', 'empty-hooks')}`, 'commit', '-qm', 'Seed isolated artifact soak']]) {
    const result = run('git', args, { cwd: workspaceRoot, env: environment });
    if (result.status !== 0) throw new Error(`isolated soak Git bootstrap failed: ${result.stderr}`);
  }
}

function bootstrapSoakRuntime(runtime, environment) {
  // Mode discovery shares the bootstrap RPC process; the state-transition
  // budget below counts every CLI invocation (run, resume, explicit replay).
  const requests = [{ jsonrpc: '2.0', id: 1, method: 'llm.status' },
    { jsonrpc: '2.0', id: 2, method: 'llm.health', params: { allow_network: true, timeout_ms: 5000 } },
    { jsonrpc: '2.0', id: 3, method: 'mode.list' }];
  const result = spawnSync(runtime, [], { cwd: environment.BROWNIE_WORKSPACE_ROOT, env: environment,
    input: requests.map((request) => JSON.stringify(request)).join('\n') + '\n', encoding: 'utf8', timeout: 15_000 });
  if (result.status !== 0) throw new Error('packaged soak Runtime bootstrap failed');
  const responses = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  const status = responses.find((response) => response.id === 1)?.result;
  const health = responses.find((response) => response.id === 2)?.result;
  const modes = responses.find((response) => response.id === 3)?.result?.modes;
  if (status?.provider !== 'OpenAiCompatible' || status.enabled !== true || status.strict !== true
    || status.will_fallback_to_fake !== false || status.llm_provider_access_allowed !== true
    || health?.attempted !== true || health.healthy !== true) throw new Error('non-Fake strict soak provider bootstrap is unavailable');
  if (!Array.isArray(modes) || !modes.some((mode) => mode.mode_id === 'implementer')) throw new Error('packaged soak Runtime did not load the implementation Mode Pack');
  return { provider: status.provider, enabled: true, strict: true, provider_access: true, healthy: true, mode_count: modes.length };
}

export async function runReleaseArtifactStatefulSoak(options = {}) {
  const workflowRunId = workflowRunIdFrom(options);
  const commandLimit = boundedCommandLimit(options);
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
  fs.mkdirSync(workspaceRoot, { recursive: true });
  if (fs.lstatSync(path.join(workspaceRoot, '.brownie'), { throwIfNoEntry: false })) throw new Error('existing Runtime state cannot be reused as a soak fixture');
  const environment = fixtureEnvironment(workspaceRoot);
  const evidence = await withFixtureProvider(environment, (provider) => {
    prepareSoakFixture(workspaceRoot, environment, provider.baseUrl);
    const bootstrap = bootstrapSoakRuntime(path.join(extractionRoot, target.runtimeName), environment);
    const beforeRun = stableWorkspaceSnapshot(workspaceRoot);
    const interrupted = run(packagedCli, ['--json', 'run', soakObjective], { cwd: workspaceRoot,
      env: { ...environment, BROWNIE_RELEASE_ARTIFACT_SOAK_PROCESS_LOSS_AFTER_JOURNEY_STARTED: '1' } });
    if (interrupted.status !== processLossExitCode) throw new Error(`runtime did not exit with the required process-loss status ${processLossExitCode} after the durable journey boundary: ${interrupted.status ?? '<signal>'}`);
    const interruptedRun = discoverInterruptedRun(workspaceRoot);
    const ledgerPath = interruptedRun.ledgerPath;
    const ledgerAfterRun = readDurableLedger(ledgerPath);
    if (!hasHeadlessJourneyStartedEvent(ledgerAfterRun)) throw new Error('process loss occurred before the durable HeadlessJourneyStarted ledger boundary');
    const afterRun = stableWorkspaceSnapshot(workspaceRoot);
    if (afterRun === beforeRun) throw new Error('runtime run did not make a durable workspace mutation');
    const resumed = requireObject(runJson(packagedCli, ['resume'], environment, workspaceRoot).resume, 'runtime process-loss recovery result');
    if (resumed.terminal_failure === true || resumed.automation?.terminal_failure === true) throw new Error('runtime task failed during process-loss recovery');
    if (resumed.status !== 'objective_proposal_applied' || resumed.objective_apply_applied !== true || resumed.objective_apply_apply_status !== 'Applied'
      || resumed.terminal_completion_final_state !== 'Completed' || resumed.terminal_completion_task_status !== 'Completed'
      || resumed.controller_action !== 'resume' || resumed.continuation_required !== true) throw new Error('runtime process-loss recovery did not apply and complete its task');
    for (const key of ['session_id', 'journey_id', 'task_id', 'run_id']) {
      if (typeof resumed[key] !== 'string' || !resumed[key]) throw new Error(`runtime process-loss recovery did not return ${key}`);
    }
    if (resumed.run_id !== interruptedRun.runId) throw new Error('runtime recovery selected a different durable run');
    const outputFile = path.join(workspaceRoot, soakOutputName);
    if (!fs.existsSync(outputFile) || fs.readFileSync(outputFile, 'utf8') !== soakOutput) throw new Error('runtime soak did not materialize the minimal task output');
    const ledgerAfterRecovery = readDurableLedger(ledgerPath);
    assertLedgerPreserved(ledgerAfterRun, ledgerAfterRecovery);
    const belongs = (event) => event.run_id === resumed.run_id && event.task_id === resumed.task_id;
    if (ledgerAfterRecovery.events.some((event) => belongs(event) && event.kind === 'TaskFailed')
      || !ledgerAfterRecovery.events.some((event) => belongs(event) && event.kind === 'TaskCompleted')
      || !ledgerAfterRecovery.events.some((event) => belongs(event) && event.kind === 'WorkspacePatchApplyResultRecorded'
        && event.payload?.applied === true && event.payload?.apply_status === 'Applied')) throw new Error('durable soak ledger did not record the completed task application');
    const afterRecovery = stableWorkspaceSnapshot(workspaceRoot);
    const replayArgs = ['resume', '--session-id', resumed.session_id, '--journey-id', resumed.journey_id, '--task-id', resumed.task_id, '--run-id', resumed.run_id];
    const replay = requireObject(runJson(packagedCli, replayArgs, environment, workspaceRoot).resume, 'runtime replay result');
    const afterReplay = stableWorkspaceSnapshot(workspaceRoot);
    const ledgerAfterReplay = readDurableLedger(ledgerPath);
    if (replay.status !== 'no_eligible_task' || replay.controller_action !== 'stop' || replay.continuation_required !== false) throw new Error('runtime did not reject replay at the terminal boundary');
    if (afterReplay !== afterRecovery || ledgerAfterReplay.sha256 !== ledgerAfterRecovery.sha256) throw new Error('replay caused a duplicate side effect after terminal convergence');
    return {
      schema_version: 1, evidence_id: 'brownie-release-artifact-stateful-soak-v1', target: target.id, workflow_run_id: workflowRunId,
      bounds: { maximum_commands: commandLimit, commands_executed: 3, command_scope: 'state_transition_cli_invocations', bootstrap_runtime_calls: 1, total_runtime_processes: 4, per_command_timeout_ms: 60_000 },
      artifact: { archive_sha256: sha256File(archivePath), ...packageIntegrity },
      checks: {
        provider_bootstrap: { passed: true, ...bootstrap },
        task_execution: { passed: true, applied: true, terminal_state: 'Completed', ledger_application_recorded: true, task_output: soakOutputName, task_output_sha256: sha256File(outputFile) },
        artifact_execution_boundary: { passed: true, packaged_cli_only: true, isolated_workspace_cwd: true, runtime_path_override_removed: true },
        process_loss_recovery: { passed: true, fresh_process_resume: true, initial_command_exit_code: interrupted.status, durable_journey_event: true, recovery_status: resumed.status },
        duplicate_side_effect_rejection: { passed: true, replay_status: replay.status, workspace_unchanged: true, ledger_unchanged: true },
        ledger_workspace_consistency: { passed: true, full_workspace_snapshot: true, ledger_prefix_preserved: true, ledger_after_run: ledgerAfterRun.sha256, ledger_after_recovery: ledgerAfterRecovery.sha256, workspace_after_run: afterRun, workspace_after_recovery: afterRecovery },
        resume_replay_behavior: { passed: true, resume_controller_action: resumed.controller_action, replay_controller_action: replay.controller_action },
        finite_convergence: { passed: true, recovery_status: resumed.status, terminal_status: replay.status, commands_executed: 3, maximum_commands: commandLimit },
        evidence_chain_integrity: { passed: true, archive_sha256: sha256File(archivePath), artifact_sha256: packageIntegrity.artifact_sha256, runtime_sha256: packageIntegrity.runtime_sha256, workspace_snapshot: afterRecovery, ledger_sha256: ledgerAfterRecovery.sha256 }
      }
    };
  });
  const outputPath = evidencePathFrom(options);
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  return evidence;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const maximumCommandsArgument = process.argv.slice(2).find((argument) => argument.startsWith('--maximum-commands='));
  const maximumCommandsValue = maximumCommandsArgument?.slice('--maximum-commands='.length);
  process.stdout.write(`${JSON.stringify(await runReleaseArtifactStatefulSoak({ cwd: repoRoot, ...(maximumCommandsValue ? { maximumCommands: maximumCommandsValue } : {}) }))}\n`);
}
