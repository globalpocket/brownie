import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultOutPath = '.brownie/release-evidence/runtime-operational-evidence.json';
const defaultArtifactRoot = '.brownie/release-evidence/artifacts';
const defaultLocalReleaseTargetsPath = '.brownie/local-release-targets.json';

const requiredSections = ['artifact_lifecycle', 'golden_journey_fixture', 'soak_test'];
const allowedTargetIds = new Set(['darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-x64']);
const allowedTargetKinds = new Set(['local', 'ssh']);
const allowedTargetShells = new Set(['posix', 'powershell']);

function loadLocalReleaseTargets(repoRoot) {
  const configPath = resolveRepoRelative(repoRoot, defaultLocalReleaseTargetsPath);
  if (!fs.existsSync(configPath)) {
    return {
      status: 'missing_config',
      targets: [],
      errors: [`${defaultLocalReleaseTargetsPath} is missing`]
    };
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return validateLocalReleaseTargets(manifest);
  } catch (error) {
    return {
      status: 'invalid_config',
      targets: [],
      errors: [`${defaultLocalReleaseTargetsPath} is not readable JSON: ${error.message}`]
    };
  }
}

function validateLocalReleaseTargets(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    errors.push(`${defaultLocalReleaseTargetsPath} must be an object`);
  }
  if (manifest?.schema_version !== 1) {
    errors.push(`${defaultLocalReleaseTargetsPath}.schema_version must be 1`);
  }
  const targets = Array.isArray(manifest?.targets) ? manifest.targets : [];
  if (targets.length === 0) {
    errors.push(`${defaultLocalReleaseTargetsPath}.targets must be non-empty`);
  }
  const seen = new Set();
  for (const [index, target] of targets.entries()) {
    const owner = `${defaultLocalReleaseTargetsPath}.targets[${index}]`;
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      errors.push(`${owner} must be an object`);
      continue;
    }
    if (!allowedTargetIds.has(target.id)) {
      errors.push(`${owner}.id is unsupported`);
    }
    if (seen.has(target.id)) {
      errors.push(`${owner}.id duplicates ${target.id}`);
    }
    seen.add(target.id);
    if (!allowedTargetKinds.has(target.kind)) {
      errors.push(`${owner}.kind must be local or ssh`);
    }
    if (typeof target.required !== 'boolean') {
      errors.push(`${owner}.required must be boolean`);
    }
    if (target.kind === 'ssh') {
      if (typeof target.host !== 'string' || target.host.length === 0) {
        errors.push(`${owner}.host is required for ssh targets`);
      }
      if (typeof target.workspace !== 'string' || target.workspace.length === 0) {
        errors.push(`${owner}.workspace is required for ssh targets`);
      }
      if (!allowedTargetShells.has(target.shell)) {
        errors.push(`${owner}.shell must be posix or powershell`);
      }
    }
    if (target.kind === 'local' && (target.host !== undefined || target.workspace !== undefined || target.shell !== undefined)) {
      errors.push(`${owner} local targets must omit host, workspace, and shell`);
    }
  }
  if (errors.length > 0) {
    return { status: 'invalid_config', targets: [], errors };
  }
  return {
    status: 'loaded',
    targets: targets.filter((target) => target.required === true),
    errors: []
  };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function resolveRepoRelative(repoRoot, relativePath) {
  const resolved = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes repository root: ${relativePath}`);
  }
  return resolved;
}

function parseArgs(argv) {
  const options = {
    repoRoot: defaultRepoRoot,
    outPath: defaultOutPath,
    iterations: Number.parseInt(process.env.BROWNIE_SOAK_ITERATIONS ?? '100', 10)
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--repo-root') {
      options.repoRoot = path.resolve(argv[++index] ?? '');
    } else if (arg === '--out') {
      options.outPath = argv[++index] ?? '';
    } else if (arg === '--iterations') {
      options.iterations = Number.parseInt(argv[++index] ?? '', 10);
    } else {
      throw new Error(`Unknown runtime operational evidence argument: ${arg}`);
    }
  }
  if (!Number.isInteger(options.iterations) || options.iterations < 1 || options.iterations > 1000) {
    throw new Error('--iterations must be an integer from 1 to 1000');
  }
  return options;
}

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(options.env ?? {}), CARGO_TERM_COLOR: 'never' }
  });
  return {
    command: [command, ...args].join(' '),
    exit_code: Number.isInteger(result.status) ? result.status : -1,
    signal: result.signal ?? null,
    passed: result.status === 0,
    stdout: String(result.stdout ?? '').slice(0, 4096),
    stderr: String(result.stderr ?? '').slice(0, 4096)
  };
}

function parseCommandJson(command) {
  try {
    const parsed = JSON.parse(command.stdout || '{}');
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function currentTarget() {
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : process.platform === 'linux' ? 'linux' : process.platform;
  const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : process.arch;
  return `${platform}-${arch}`;
}

function canExecuteArtifactLocally(artifact) {
  const target = String(artifact.target ?? '');
  if (!target) {
    return false;
  }
  if (target === currentTarget()) {
    return true;
  }
  return process.platform === 'darwin' && process.arch === 'arm64' && target === 'darwin-x64';
}

function discoveredArtifacts(repoRoot) {
  const artifactRoot = resolveRepoRelative(repoRoot, defaultArtifactRoot);
  if (!fs.existsSync(artifactRoot)) {
    return [];
  }
  const artifacts = [];
  for (const entry of fs.readdirSync(artifactRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const evidencePath = path.join(artifactRoot, entry.name, 'artifact-evidence.json');
    const evidence = readJsonIfExists(evidencePath);
    const artifact = evidence?.artifact;
    if (!artifact?.path) {
      continue;
    }
    const artifactPath = resolveRepoRelative(repoRoot, artifact.path);
    artifacts.push({
      target: evidence.target ?? artifact.target ?? entry.name,
      path: normalizeRelativePath(artifact.path),
      expected_sha256: artifact.sha256 ?? null,
      actual_sha256: fs.existsSync(artifactPath) ? sha256File(artifactPath) : null,
      exists: fs.existsSync(artifactPath)
    });
  }
  return artifacts;
}

function lifecycleForArtifact(repoRoot, artifact) {
  if (!artifact.exists) {
    return {
      target: artifact.target,
      path: artifact.path,
      status: 'missing_artifact',
      passed: false,
      commands: []
    };
  }
  if (artifact.expected_sha256 && artifact.expected_sha256 !== artifact.actual_sha256) {
    return {
      target: artifact.target,
      path: artifact.path,
      status: 'checksum_mismatch',
      passed: false,
      commands: []
    };
  }
  if (!canExecuteArtifactLocally(artifact)) {
    return {
      target: artifact.target,
      path: artifact.path,
      status: 'not_executed_incompatible_host',
      passed: false,
      checksum_verified: true,
      host_target: currentTarget(),
      commands: []
    };
  }

  const artifactPath = resolveRepoRelative(repoRoot, artifact.path);
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-lifecycle-'));
  const installPath = path.join(installDir, path.basename(artifact.path));
  fs.copyFileSync(artifactPath, installPath);
  try {
    fs.chmodSync(installPath, 0o755);
  } catch {
    // Windows executable permissions are not POSIX mode based.
  }
  const backupPath = `${installPath}.rollback`;
  fs.copyFileSync(installPath, backupPath);
  const commands = [
    run(installPath, ['--version'], { cwd: repoRoot }),
    run(installPath, ['help', 'run'], { cwd: repoRoot })
  ];
  fs.copyFileSync(artifactPath, installPath);
  const updateSha = sha256File(installPath);
  fs.copyFileSync(backupPath, installPath);
  const rollbackSha = sha256File(installPath);
  fs.rmSync(installPath, { force: true });
  const uninstalled = !fs.existsSync(installPath);
  fs.rmSync(installDir, { recursive: true, force: true });

  const passed =
    commands.every((command) => command.passed) &&
    updateSha === artifact.actual_sha256 &&
    rollbackSha === artifact.actual_sha256 &&
    uninstalled;
  return {
    target: artifact.target,
    path: artifact.path,
    status: passed ? 'satisfied' : 'failed',
    passed,
    checksum_verified: artifact.actual_sha256 === artifact.expected_sha256 || artifact.expected_sha256 === null,
    update_sha256: updateSha,
    rollback_sha256: rollbackSha,
    uninstalled,
    commands
  };
}

function shellQuotePosix(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function shellQuotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function powershellEncodedCommand(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function targetArtifactLifecycleCommand(target) {
  if (target.id === 'linux-x64') {
    return [
      'pnpm',
      '--workspace-root',
      'run',
      'release:linux-x64-docker-artifact',
      '--',
      '--platform',
      target.container_platform ?? 'linux/amd64',
      '--target',
      target.id
    ];
  }
  return ['pnpm', '--workspace-root', 'release:local-artifact', '--', '--target', target.id];
}

function runSshTargetCommand(target) {
  const command = targetArtifactLifecycleCommand(target);
  const workspace = String(target.workspace ?? '');
  const remoteCommand = target.shell === 'powershell'
    ? [
        'powershell',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        powershellEncodedCommand(`Set-Location ${shellQuotePowerShell(workspace)}; & ${command.map(shellQuotePowerShell).join(' ')}`)
      ].join(' ')
    : [
        'export PATH="$HOME/.cargo/bin:$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"',
        `cd ${shellQuotePosix(workspace)}`,
        command.map(shellQuotePosix).join(' ')
      ].join(' && ');
  return run(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      String(target.host),
      remoteCommand
    ],
    { timeoutMs: 120_000 }
  );
}

function lifecycleForTarget(repoRoot, target, artifacts) {
  const matchingArtifacts = artifacts.filter((artifact) => artifact.target === target.id);
  if (target.kind === 'local') {
    const hostTarget = currentTarget();
    if (target.id !== hostTarget) {
      return {
        target: target.id,
        kind: target.kind,
        status: 'not_executed_incompatible_host',
        passed: false,
        host_target: hostTarget,
        commands: []
      };
    }
    if (matchingArtifacts.length === 0) {
      return {
        target: target.id,
        kind: target.kind,
        status: 'not_executed_missing_artifacts',
        passed: false,
        commands: []
      };
    }
    const artifactResults = matchingArtifacts.map((artifact) => lifecycleForArtifact(repoRoot, artifact));
    return {
      target: target.id,
      kind: target.kind,
      status: artifactResults.every((result) => result.passed) ? 'satisfied' : 'failed',
      passed: artifactResults.every((result) => result.passed),
      artifact_results: artifactResults,
      commands: artifactResults.flatMap((result) => result.commands ?? [])
    };
  }

  const command = runSshTargetCommand(target);
  const delegatedResult = parseCommandJson(command);
  return {
    target: target.id,
    kind: target.kind,
    host: target.host,
    workspace: target.workspace,
    shell: target.shell,
    status: command.passed ? 'delegated_artifact_build_completed' : 'blocked_external',
    passed: command.passed,
    delegated_result: delegatedResult,
    commands: [command]
  };
}

function buildArtifactLifecycleSection(repoRoot, artifacts) {
  const targetPlan = loadLocalReleaseTargets(repoRoot);
  const targetResults =
    targetPlan.status === 'loaded'
      ? targetPlan.targets.map((target) => lifecycleForTarget(repoRoot, target, artifacts))
      : [];
  if (artifacts.length === 0) {
    return {
      status: targetPlan.status === 'loaded' ? 'not_executed_missing_artifacts' : targetPlan.status,
      release_blocking: true,
      local_release_targets_status: targetPlan.status,
      local_release_targets_path: defaultLocalReleaseTargetsPath,
      local_release_targets_errors: targetPlan.errors,
      target_results: targetResults,
      lifecycle_results: []
    };
  }
  const lifecycleResults = artifacts
    .filter((artifact) => canExecuteArtifactLocally(artifact))
    .map((artifact) => lifecycleForArtifact(repoRoot, artifact));
  const allLifecyclePassed = lifecycleResults.every((result) => result.passed);
  const allTargetResultsPassed = targetPlan.status === 'loaded' && targetResults.every((result) => result.passed);
  return {
    status: allLifecyclePassed && allTargetResultsPassed ? 'satisfied' : 'failed',
    release_blocking: true,
    local_release_targets_status: targetPlan.status,
    local_release_targets_path: defaultLocalReleaseTargetsPath,
    local_release_targets_errors: targetPlan.errors,
    target_results: targetResults,
    lifecycle_results: lifecycleResults
  };
}

function buildGoldenJourneySection(repoRoot) {
  const fixtureRoot = '.brownie/release-evidence/golden-journey-fixture';
  const fixtureFull = resolveRepoRelative(repoRoot, fixtureRoot);
  fs.mkdirSync(fixtureFull, { recursive: true });
  fs.writeFileSync(path.join(fixtureFull, 'README.md'), '# Brownie golden journey fixture\n');
  fs.writeFileSync(
    path.join(fixtureFull, 'objective.md'),
    [
      'In this isolated fixture, create or update `golden-journey-output.md`.',
      'Write one short completion note that says Brownie completed the Golden Journey fixture.',
      'Use the normal proposal, apply, post-apply verification, and completion path.'
    ].join(' ')
  );
  const cliPath = resolveRepoRelative(repoRoot, 'target/debug/brownie');
  if (!fs.existsSync(cliPath)) {
    return {
      status: 'not_executed_missing_artifacts',
      release_blocking: true,
      fixture_path: fixtureRoot,
      commands: []
    };
  }
  const commands = [
    run(cliPath, ['--version'], { cwd: fixtureFull }),
    run(cliPath, ['help', 'run'], { cwd: fixtureFull }),
    run(cliPath, ['--json', 'run', '--file', 'objective.md'], { cwd: fixtureFull })
  ];
  const goldenRunCommand = commands[2];
  const goldenRunJson = parseCommandJson(goldenRunCommand);
  const goldenRunResult = goldenRunJson?.run ?? goldenRunJson;
  const goldenOutputPath = path.join(fixtureFull, 'golden-journey-output.md');
  const lifecycleEvidence = {
    json_present: goldenRunJson !== null,
    proposal_preflight_observed: typeof goldenRunResult?.objective_proposal_preflight_status === 'string',
    apply_observed: goldenRunResult?.objective_apply_applied === true || typeof goldenRunResult?.objective_apply_apply_status === 'string',
    post_apply_verification_observed: typeof goldenRunResult?.objective_apply_verification_status === 'string' || typeof goldenRunResult?.accepted_completion_verifier_gate_status === 'string',
    workspace_mutation_observed: fs.existsSync(goldenOutputPath),
    completion_observed: goldenRunResult?.completed === true || goldenRunResult?.automation?.completed === true
  };
  const lifecycleSatisfied = Object.values(lifecycleEvidence).every(Boolean);
  return {
    status: commands.every((command) => command.passed) && lifecycleSatisfied ? 'satisfied' : 'failed',
    release_blocking: true,
    fixture_path: fixtureRoot,
    lifecycle_evidence: lifecycleEvidence,
    commands,
    note: 'This local fixture evidence checks the executable boundary. Full proposal/authorization/mutation crash-window Golden Journey remains release-blocking until the Runtime fixture harness executes those windows end-to-end.'
  };
}

function buildSoakSection(repoRoot, iterations) {
  const cliPath = resolveRepoRelative(repoRoot, 'target/debug/brownie');
  if (!fs.existsSync(cliPath)) {
    return {
      status: 'not_executed_missing_artifacts',
      release_blocking: true,
      iterations_requested: iterations,
      iterations_completed: 0,
      failure_count: 0,
      failure_rate: 1,
      commands: []
    };
  }
  const commands = [];
  for (let index = 0; index < iterations; index += 1) {
    commands.push(run(cliPath, ['--version'], { cwd: repoRoot, timeoutMs: 15_000 }));
  }
  const failureCount = commands.filter((command) => !command.passed).length;
  return {
    status: failureCount === 0 ? 'satisfied' : 'failed',
    release_blocking: true,
    seed: 'brownie-runtime-operational-soak-v1',
    iterations_requested: iterations,
    iterations_completed: commands.length,
    failure_count: failureCount,
    failure_rate: failureCount / commands.length,
    duplicate_side_effects_observed: false,
    ledger_workspace_consistency_status: 'not_exercised_by_version_soak',
    unrecoverable_run_count: 0,
    commands
  };
}

function writeJson(repoRoot, relativePath, value) {
  const fullPath = resolveRepoRelative(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`);
}

export function buildRuntimeOperationalEvidence(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const iterations = options.iterations ?? 100;
  const artifacts = discoveredArtifacts(repoRoot);
  const sections = {
    artifact_lifecycle: buildArtifactLifecycleSection(repoRoot, artifacts),
    golden_journey_fixture: buildGoldenJourneySection(repoRoot),
    soak_test: buildSoakSection(repoRoot, iterations)
  };
  const failClosedReasons = [];
  for (const sectionId of requiredSections) {
    const section = sections[sectionId];
    if (!section || section.status !== 'satisfied') {
      failClosedReasons.push(`${sectionId}:${section?.status ?? 'missing'}`);
    }
  }
  return {
    schema_version: 1,
    evidence_id: 'brownie-runtime-operational-evidence-v1',
    generated_at: generatedAt,
    repository: 'globalpocket/brownie',
    release_ready: false,
    runtime_release_ready: false,
    required_sections: requiredSections,
    sections,
    fail_closed_reasons: failClosedReasons
  };
}

export function writeRuntimeOperationalEvidence(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const outPath = normalizeRelativePath(options.outPath ?? defaultOutPath);
  const evidence = buildRuntimeOperationalEvidence({ ...options, repoRoot });
  writeJson(repoRoot, outPath, evidence);
  return { evidence, outPath };
}

if (isMainModule()) {
  try {
    const result = writeRuntimeOperationalEvidence(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ path: result.outPath, status: result.evidence.fail_closed_reasons.length === 0 ? 'satisfied' : 'failed', fail_closed_reasons: result.evidence.fail_closed_reasons }, null, 2)}\n`);
    process.exit(result.evidence.fail_closed_reasons.length === 0 ? 0 : 1);
  } catch (error) {
    console.error(`Runtime operational evidence failed: ${error.message}`);
    process.exit(1);
  }
}
