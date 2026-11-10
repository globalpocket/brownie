import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const journeyOutputName = 'journey-output.md';
const journeyOutput = 'Brownie completed the artifact Runtime journey.\n';
const journeyObjective = `In this isolated fixture, update \`${journeyOutputName}\`. Replace its contents with exactly: ${journeyOutput.trim()} Use the normal workspace.write proposal, apply, post-apply verification, and completion path.`;
const snapshotBudget = Object.freeze({ maximumEntries: 4096, maximumDepth: 64, maximumBytes: 64 * 1024 * 1024 });

const releaseTargets = [
  { id: 'linux-x64', archiveName: 'brownie-linux-x64.tar.gz', archiveType: 'tar', binaryName: 'brownie', runtimeName: 'brownie-runtime' },
  { id: 'darwin-arm64', archiveName: 'brownie-darwin-arm64.tar.gz', archiveType: 'tar', binaryName: 'brownie', runtimeName: 'brownie-runtime' },
  { id: 'win32-x64', archiveName: 'brownie-win32-x64.zip', archiveType: 'zip', binaryName: 'brownie.exe', runtimeName: 'brownie-runtime.exe' }
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
    throw new Error('extracted artifact is missing package integrity evidence');
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
  const result = run(binaryPath, ['--json', ...args], { env: environment, cwd: environment.BROWNIE_WORKSPACE_ROOT });
  if (result.status !== 0) throw new Error(`packaged CLI ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`packaged CLI ${args.join(' ')} did not return JSON: ${error.message}`);
  }
}

export async function stopFixtureProvider(child, root) {
  if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(terminateTimer);
        clearTimeout(deadlineTimer);
        child.removeListener('exit', onExit);
        child.removeListener('error', onError);
      };
      const onExit = () => { cleanup(); resolve(); };
      const onError = (error) => { cleanup(); reject(error); };
      const terminateTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
      const deadlineTimer = setTimeout(() => onError(new Error('fixture provider did not exit; preserving its directory')), 10_000);
      child.once('exit', onExit);
      child.once('error', onError);
      child.kill('SIGTERM');
    });
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

export async function withFixtureProvider(environment, operation) {
  const provider = await startFixtureProvider(environment);
  let operationError;
  try {
    return await operation(provider);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await provider.stop();
    } catch (cleanupError) {
      if (operationError) throw new AggregateError([operationError, cleanupError], `Runtime journey failed: ${operationError.message}; provider cleanup failed: ${cleanupError.message}`, { cause: operationError });
      throw cleanupError;
    }
  }
}

async function startFixtureProvider(environment) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-journey-provider-'));
  const portPath = path.join(root, 'port.json');
  const scriptPath = path.join(root, 'server.mjs');
  const responses = [
    { tool_id: 'workspace.read', reason: 'Read the isolated output before updating it.', input: { path: journeyOutputName } },
    { tool_id: 'workspace.write', reason: 'Complete the isolated artifact journey.', input: { path: journeyOutputName, operation: 'replace_file', content: journeyOutput } }
  ].map((request) => ({ choices: [{ message: { content: '```brownie-tool-intent\n' + JSON.stringify({ tool_requests: [request] }) + '\n```' } }] }));
  fs.writeFileSync(scriptPath, [
    "import fs from 'node:fs'; import http from 'node:http';",
    `const responses = ${JSON.stringify(responses)};`,
    `const portPath = ${JSON.stringify(portPath)};`,
    `const parent = ${process.pid};`,
    'let index = 0;',
    'const server = http.createServer((request, response) => {',
    "  const send = (code, value) => { const body = JSON.stringify(value); response.writeHead(code, {'content-type':'application/json','content-length':Buffer.byteLength(body)}); response.end(body); };",
    "  if (request.method === 'GET' && request.url === '/v1/models') return send(200, {data:[{id:'artifact-journey-fixture'}]});",
    "  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') return send(404, {error:'not_found'});",
    '  let bytes = 0;',
    "  request.on('data', chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) request.destroy(); });",
    "  request.on('end', () => { if (index >= 12) return send(429, {error:'fixture_request_budget'}); send(200, responses[Math.min(index++, responses.length - 1)]); });",
    '});',
    "server.listen(0, '127.0.0.1', () => fs.writeFileSync(portPath, JSON.stringify({base_url:'http://127.0.0.1:'+server.address().port+'/v1'})));",
    "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
    'setInterval(() => { try { process.kill(parent, 0); } catch { server.close(() => process.exit(0)); } }, 1000).unref();'
  ].join('\n'));
  const child = spawn(process.execPath, [scriptPath], { cwd: root, env: environment, stdio: 'ignore' });
  const stop = () => stopFixtureProvider(child, root);
  let startupError;
  child.on('error', (error) => { startupError = error; });
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(portPath) && !startupError && child.exitCode === null && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  if (!fs.existsSync(portPath)) { await stop(); throw startupError ?? new Error('isolated fixture provider bootstrap timed out'); }
  return { baseUrl: JSON.parse(fs.readFileSync(portPath, 'utf8')).base_url, stop };
}

function fixtureEnvironment(workspaceRoot) {
  const environment = {};
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'COMSPEC', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  const home = path.join(workspaceRoot, '.brownie', 'fixture-home');
  fs.mkdirSync(home, { recursive: true });
  return { ...environment, HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull,
    GIT_TERMINAL_PROMPT: '0', BROWNIE_WORKSPACE_ROOT: workspaceRoot, BROWNIE_CLI_RUN_MODE_ID: 'implementer',
    BROWNIE_TEST_LLM_API_KEY: 'isolated-fixture-key', BROWNIE_LLM_ALLOW_PROVIDER_ACCESS: 'true' };
}

function prepareFixture(workspaceRoot, environment, baseUrl) {
  const config = path.join(workspaceRoot, '.brownie', 'config.json');
  for (const name of ['.git', '.gitignore', journeyOutputName]) {
    if (fs.lstatSync(path.join(workspaceRoot, name), { throwIfNoEntry: false })) throw new Error(`isolated fixture path already exists: ${name}`);
  }
  if (fs.existsSync(config) || fs.existsSync(path.join(workspaceRoot, '.brownie', 'runs'))) throw new Error('existing Runtime state cannot be reused as an artifact fixture');
  fs.writeFileSync(config, JSON.stringify({ version: 1, active_profile: 'artifact-journey-fixture', llm: { profiles: {
    'artifact-journey-fixture': { provider: 'openai-compatible', base_url: baseUrl, model: 'artifact-journey-fixture', api_key_env: 'BROWNIE_TEST_LLM_API_KEY', strict: true }
  } } }));
  fs.writeFileSync(path.join(workspaceRoot, journeyOutputName), 'Pending artifact Runtime journey.\n');
  fs.writeFileSync(path.join(workspaceRoot, '.gitignore'), '.brownie/\n');
  for (const args of [['init', '-q'], ['add', '--', '.gitignore', journeyOutputName],
    ['-c', 'user.name=Brownie Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgSign=false', '-c', `core.hooksPath=${path.join(workspaceRoot, '.brownie', 'empty-hooks')}`, 'commit', '-qm', 'Seed isolated artifact journey']]) {
    const result = run('git', args, { cwd: workspaceRoot, env: environment });
    if (result.status !== 0) throw new Error(`isolated Git fixture bootstrap failed: ${result.stderr}`);
  }
}

function assertFixtureProvider(runtimePath, environment) {
  const requests = [{ jsonrpc: '2.0', id: 1, method: 'llm.status' },
    { jsonrpc: '2.0', id: 2, method: 'llm.health', params: { allow_network: true, timeout_ms: 5000 } }];
  const result = spawnSync(runtimePath, [], { cwd: environment.BROWNIE_WORKSPACE_ROOT, env: environment,
    input: requests.map((request) => JSON.stringify(request)).join('\n') + '\n', encoding: 'utf8', timeout: 15_000 });
  if (result.status !== 0) throw new Error('packaged Runtime provider bootstrap failed');
  const responses = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  const status = responses.find((response) => response.id === 1)?.result;
  const health = responses.find((response) => response.id === 2)?.result;
  if (status?.provider !== 'OpenAiCompatible' || status.enabled !== true || status.strict !== true
    || status.will_fallback_to_fake !== false || status.llm_provider_access_allowed !== true
    || health?.attempted !== true || health.healthy !== true) throw new Error('non-Fake strict fixture provider bootstrap is unavailable');
  return { provider: status.provider, enabled: true, strict: true, provider_access: true, healthy: true };
}

function durableLedger(workspaceRoot) {
  const root = path.join(workspaceRoot, '.brownie', 'runs');
  const paths = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'ledger.jsonl')).filter((file) => fs.existsSync(file)) : [];
  if (paths.length !== 1) throw new Error('interruption must create exactly one durable run ledger');
  const text = fs.readFileSync(paths[0], 'utf8');
  let events;
  try { events = text.trim().split('\n').map((line) => JSON.parse(line)); } catch { throw new Error('durable run ledger must be valid JSONL'); }
  if (!text || events.some((event) => !event || typeof event !== 'object' || Array.isArray(event))) throw new Error('durable run ledger events are missing');
  return { path: paths[0], text, events };
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
    rows.push([relative, 'directory', fs.statSync(current).mode & 0o777]);
    if (activeDirectories.has(canonicalDirectory)) {
      rows.push([relative, 'directory-cycle']);
      return;
    }
    const nextActiveDirectories = new Set(activeDirectories);
    nextActiveDirectories.add(canonicalDirectory);
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
    } else if (metadata.isFile()) {
      rows.push([relative, 'file', metadata.mode & 0o777, snapshotFile(current, metadata.size)]);
    } else if (metadata.isSymbolicLink()) {
      rows.push([relative, 'symlink', fs.readlinkSync(current)]);
      let target;
      try {
        target = fs.statSync(current);
      } catch (error) {
        throw new Error(`workspace snapshot cannot resolve symbolic link ${relative}: ${error.message}`);
      }
      if (target.isDirectory()) visitDirectory(current, `${relative}:target`, activeDirectories, depth);
      else if (target.isFile()) rows.push([relative, 'target-file', target.mode & 0o777, snapshotFile(current, target.size)]);
      else throw new Error(`workspace snapshot does not support symbolic link target ${relative}`);
    } else {
      throw new Error(`workspace snapshot does not support ${relative}`);
    }
  };
  if (fs.existsSync(workspaceRoot)) visitDirectory(workspaceRoot, '', new Set());
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')}`;
}

function requireObject(value, description) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${description} is missing`);
  return value;
}

function evidencePathFrom(options) {
  return options.evidencePath ?? process.env.BROWNIE_RELEASE_RUNTIME_JOURNEY_EVIDENCE_PATH ?? '';
}

export async function runReleaseArtifactRuntimeJourney(options = {}) {
  const workflowRunId = options.workflowRunId ?? process.env.GITHUB_RUN_ID ?? null;
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
  fs.mkdirSync(workspaceRoot, { recursive: true });
  if (fs.lstatSync(path.join(workspaceRoot, '.brownie'), { throwIfNoEntry: false })) throw new Error('existing Runtime state cannot be reused as an artifact fixture');
  const environment = fixtureEnvironment(workspaceRoot);
  const evidence = await withFixtureProvider(environment, (provider) => {
    prepareFixture(workspaceRoot, environment, provider.baseUrl);
    const providerBootstrap = assertFixtureProvider(path.join(extractionRoot, target.runtimeName), environment);
    const modeList = runJson(packagedCli, ['mode', 'list'], environment);
    const modes = modeList?.mode_list?.modes;
    if (!Array.isArray(modes) || !modes.some((mode) => mode.mode_id === 'implementer')) throw new Error('packaged CLI did not load the implementation Mode Pack');
    const beforeRun = stableWorkspaceSnapshot(workspaceRoot);
    const interrupted = run(packagedCli, ['--json', 'run', journeyObjective], { cwd: workspaceRoot,
      env: { ...environment, BROWNIE_RELEASE_ARTIFACT_SOAK_PROCESS_LOSS_AFTER_JOURNEY_STARTED: '1' } });
    if (interrupted.status !== 75) throw new Error(`runtime did not exit with the required process-loss status 75: ${interrupted.status ?? '<signal>'}`);
    const interruption = JSON.parse(interrupted.stdout);
    if (interruption.status !== 'runtime_process_loss' || interruption.automation?.stop_class !== 'process_loss'
      || interruption.automation?.completed !== false || interruption.automation?.terminal_failure !== false) {
      throw new Error('process-loss exit did not carry the controlled interruption contract');
    }
    const initialLedger = durableLedger(workspaceRoot);
    if (!initialLedger.events.some((event) => event.kind === 'HeadlessJourneyStarted')) throw new Error('process loss preceded the durable journey boundary');
    const afterRun = stableWorkspaceSnapshot(workspaceRoot);
    if (afterRun === beforeRun) throw new Error('runtime run did not make a durable workspace mutation');

    let applied;
    let terminal;
    let resumeAttempts = 0;
    for (; resumeAttempts < 4; resumeAttempts += 1) {
      const result = requireObject(runJson(packagedCli, ['resume'], environment).resume, 'runtime resume result');
      if (result.automation?.terminal_failure === true || result.terminal_failure === true) throw new Error('runtime task failed during process-loss recovery');
      if (result.objective_apply_applied === true && result.objective_apply_apply_status === 'Applied'
        && result.terminal_completion_final_state === 'Completed' && result.terminal_completion_task_status === 'Completed') applied = result;
      if (result.status === 'no_eligible_task' && result.controller_action === 'stop' && result.continuation_required === false) {
        terminal = result;
        resumeAttempts += 1;
        break;
      }
      if (result.automation?.continuation_required !== true && result.continuation_required !== true) throw new Error('runtime did not expose a bounded recovery continuation');
    }
    if (!terminal) throw new Error('runtime did not converge within the resume attempt budget');
    const outputFile = path.join(workspaceRoot, journeyOutputName);
    if (!applied || !fs.existsSync(outputFile) || fs.readFileSync(outputFile, 'utf8') !== journeyOutput) throw new Error('runtime did not materialize the minimal task output');
    const recoveredLedger = durableLedger(workspaceRoot);
    if (!recoveredLedger.text.startsWith(initialLedger.text)) throw new Error('runtime recovery truncated or rewrote the durable ledger');
    const belongsToAppliedRun = (event) => event.run_id === applied.run_id && event.task_id === applied.task_id;
    if (!recoveredLedger.events.some((event) => belongsToAppliedRun(event) && event.kind === 'TaskCompleted')
      || !recoveredLedger.events.some((event) => belongsToAppliedRun(event) && event.kind === 'WorkspacePatchApplyResultRecorded'
        && event.payload?.applied === true && event.payload?.apply_status === 'Applied')) throw new Error('durable ledger did not record the completed task application');
    for (const key of ['session_id', 'journey_id', 'task_id', 'run_id']) {
      if (typeof applied[key] !== 'string' || !applied[key]) throw new Error(`runtime recovery did not return ${key}`);
    }
    const afterResume = stableWorkspaceSnapshot(workspaceRoot);
    const replayArgs = ['resume', '--session-id', applied.session_id, '--journey-id', applied.journey_id, '--task-id', applied.task_id, '--run-id', applied.run_id];
    const replay = requireObject(runJson(packagedCli, replayArgs, environment).resume, 'runtime replay result');
    const afterReplay = stableWorkspaceSnapshot(workspaceRoot);
    const replayLedger = durableLedger(workspaceRoot);
    if (replay.status !== 'no_eligible_task' || replay.controller_action !== 'stop' || replay.continuation_required !== false
      || afterReplay !== afterResume || replayLedger.text !== recoveredLedger.text) throw new Error('runtime did not reject replay without a side effect');

    const evidence = {
      schema_version: 1, evidence_id: 'brownie-release-artifact-runtime-journey-v1', target: target.id, workflow_run_id: workflowRunId,
      artifact: { archive_sha256: sha256File(archivePath), ...packageIntegrity },
      bounds: { maximum_resume_attempts: 4, resume_attempts: resumeAttempts, cli_commands_executed: 3 + resumeAttempts, per_command_timeout_ms: 60_000 },
      checks: {
        provider_bootstrap: { passed: true, ...providerBootstrap },
        mode_pack_load: { passed: true, mode_count: modes.length },
        workspace_mutation: { passed: true, before: beforeRun, after: afterResume, task_output: journeyOutputName, task_output_sha256: sha256File(outputFile) },
        task_execution: { passed: true, applied: true, terminal_state: 'Completed', ledger_application_recorded: true },
        ledger_generation: { passed: true, ledger_sha256: sha256File(recoveredLedger.path), prefix_preserved: true },
        forced_interruption: { passed: true, initial_command_exit_code: interrupted.status, durable_journey_event: true, controller_action: 'resume', stop_reason: interruption.status },
        resume: { passed: true, status: terminal.status, controller_action: terminal.controller_action, recovered_task_applied: true },
        stale_replay_rejection: { passed: true, status: replay.status, controller_action: replay.controller_action, workspace_unchanged: true, ledger_unchanged: true }
      }
    };
    return evidence;
  });
  const outputPath = evidencePathFrom(options);
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  return evidence;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const evidence = await runReleaseArtifactRuntimeJourney({ cwd: repoRoot });
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}
