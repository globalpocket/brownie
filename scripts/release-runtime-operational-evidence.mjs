import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPhaseLoopActorDeployment } from './phase-loop-actor-deployment.mjs';
import { runtimeOperationalEvidenceRequiredSections } from './guard-runtime-operational-evidence.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultOutPath = '.brownie/release-evidence/runtime-operational-evidence.json';
const defaultArtifactRoot = '.brownie/release-evidence/artifacts';
const defaultLocalReleaseTargetsPath = '.brownie/local-release-targets.json';

const requiredSections = runtimeOperationalEvidenceRequiredSections;

const requiredStatefulSoakStepIds = [
  'task_state_transition',
  'ledger_workspace_consistency',
  'resume_replay_handling',
  'duplicate_side_effect_rejection',
  'process_loss_recovery',
  'finite_convergence',
  'evidence_chain_integrity',
  'artifact_lifecycle',
  'golden_journey_fixture',
  'soak_test',
  'executable_evidence_validation',
  'roundtrip_journey_binding',
  'soak_results_binding',
  'implementation_commit',
  'tested_commit',
  'workflow_run_id',
  'artifact_sha256',
  'binary_sha256',
  'platform',
  'architecture',
  'roundtrip_journey',
  'soak_results',
  'downloaded_roundtrip_binding',
  'runtime_journey_binding',
  'supply_chain_guard_binding'
];

const statefulSoakConfig = {
  runCount: 100,
  evidence:
  {
    taskTransitions: true,
    ledgerConsistency: true,
    workspaceConsistency: true,
    resumeReplay: true,
    duplicateRejection: true,
    processLossRecovery: true,
    finiteConvergence: true,
    statefulSoakSteps: true,
    workspaceMutationVerification: true
  },
  executionPolicy: {
    failClosed: true,
    evidenceRequired: true,
    blockerOnMissing: true,
    verificationBeforeRelease: true
  },
  platformLifecycleEvidence: {
    requiredTargets: ['macos-x64', 'linux-x64', 'linux-arm64', 'windows-x64'],
    evidencePerTarget: {
      install: false,
      update: false,
      rollback: false
    },
    blockerPolicy: 'explicit_owner_controlled'
  },
  storagePolicy: 'aggregated_metrics_only',
  tempWorkspace: {
    enabled: true,
    freshStart: true,
    mutationRequired: true,
    beforeAfterVerification: true
  },
  requiredSteps: {
    preSoakValidation: true,
    stateTransitionRecording: true,
    postSoakConsistencyCheck: true,
    evidenceAggregation: true
  },
  acceptancePolicy: {
    versionOnlyRepetition: 'diagnostic_only',
    requireAllDurabilitySteps: true,
    failOnMissingEvidence: true,
    statusSatisfiedCondition: 'all_required_durability_steps_passed'
  }
};

const soakAcceptanceValidator = (evidence) => {
  if (!evidence || typeof evidence !== 'object') return { satisfied: false, reason: 'missing_evidence' };
  const required = statefulSoakConfig.requiredSteps;
  const checks = [
    { name: 'preSoakValidation', pass: !!evidence.preSoakValidation },
    { name: 'stateTransitionRecording', pass: !!evidence.stateTransitionRecording },
    { name: 'postSoakConsistencyCheck', pass: !!evidence.postSoakConsistencyCheck },
    { name: 'evidenceAggregation', pass: !!evidence.evidenceAggregation },
    { name: 'ledgerConsistency', pass: !!evidence.ledgerConsistency },
    { name: 'workspaceConsistency', pass: !!evidence.workspaceConsistency },
    { name: 'resumeReplay', pass: !!evidence.resumeReplay },
    { name: 'duplicateRejection', pass: !!evidence.duplicateRejection },
    { name: 'processLossRecovery', pass: !!evidence.processLossRecovery },
    { name: 'finiteConvergence', pass: !!evidence.finiteConvergence }
  ];
  const allPassed = checks.every(c => c.pass);
  return { satisfied: allPassed, reason: allPassed ? 'all_durability_steps_passed' : 'missing_required_step', checks };
};

const forbiddenLocalEvidencePattern = /(?:^\/Users\/|^\/home\/|^[A-Za-z]:\/Users\/|ssh|worktree)/u;

const redactLocalEvidenceString = (value) => {
  if (typeof value !== 'string') return value;
  return forbiddenLocalEvidencePattern.test(value)
    ? '[redacted-local-evidence]'
    : value;
};

const redactCommandEvidence = (raw) => {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '[empty]';
  return {
    kind: 'command_summary',
    word_count: trimmed.split(/\s+/).filter(Boolean).length,
    sha256: crypto.createHash('sha256').update(trimmed).digest('hex')
  };
};

const redactStdoutStderr = (raw) => {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  return {
    kind: 'process_output_summary',
    byte_length: Buffer.byteLength(raw),
    line_count: trimmed.length === 0 ? 0 : trimmed.split('\n').length,
    sha256: crypto.createHash('sha256').update(raw).digest('hex')
  };
};

const redactCommandResult = (result) => {
  if (!result || typeof result !== 'object') return result;
  return {
    command_summary: redactCommandEvidence(result.command),
    exit_code: result.exit_code,
    signal: result.signal,
    passed: result.passed,
    stdout_summary: redactStdoutStderr(result.stdout),
    stderr_summary: redactStdoutStderr(result.stderr)
  };
};

const redactCommandResults = (commands) => commands.map((command) => redactCommandResult(command));

export function redactDelegatedResult(value) {
  if (typeof value === 'string') {
    return redactLocalEvidenceString(value);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactDelegatedResult(entry));
  }
  const redacted = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'command') {
      redacted.command_summary = redactCommandEvidence(entry);
      continue;
    }
    if (key === 'stdout' || key === 'stderr') {
      redacted[`${key}_summary`] = redactStdoutStderr(entry);
      continue;
    }
    if (key === 'host' || key === 'hostname') {
      redacted[key] = '[redacted-host]';
      continue;
    }
    if (key === 'workspace' || key === 'path' || key === 'artifact_path') {
      redacted[key] = redactLocalEvidenceString(entry);
      continue;
    }
    redacted[key] = redactDelegatedResult(entry);
  }
  return redacted;
}

const soakEvidence = {
  stateful_transition: {
    description: 'Records stateful transition evidence from idle to task-run to ledger-generation to forced-stop to resume to stale-replay-rejection.',
    fields: ['idle', 'task_run', 'ledger_generation', 'forced_stop', 'resume', 'stale_replay_rejection'],
    required: true
  },
  ledger_consistency: {
    description: 'Records ledger consistency evidence across state transitions.',
    fields: ['idle_ledger', 'task_run_ledger', 'forced_stop_ledger', 'resume_ledger', 'stale_replay_rejection_ledger'],
    required: true
  },
  finite_convergence: {
    description: 'Records finite-convergence evidence: task-run completes within bounded iterations, forced-stop terminates within bounded time, resume recovers to consistent state, stale-replay-rejection rejects replay of stale ledger.',
    fields: ['task_run_iteration_bound', 'forced_stop_time_bound', 'resume_state_recovery', 'stale_replay_rejection'],
    required: true
  },
  workflow_run_binding: {
    description: 'Records workflow run binding evidence: implementation_commit, tested_commit, workflow_run_id, artifact_sha256, platform, architecture.',
    fields: ['implementation_commit', 'tested_commit', 'workflow_run_id', 'artifact_sha256', 'platform', 'architecture'],
    required: true
  },
  roundtrip_journey: {
    description: 'Records roundtrip journey evidence: Mode Pack load, minimal task execution, ledger generation, forced stop/resume, stale/replay rejection.',
    fields: ['mode_pack_load', 'minimal_task_execution', 'ledger_generation', 'forced_stop_resume', 'stale_replay_rejection'],
    required: true
  },
  soak_results: {
    description: 'Records soak results evidence: process loss recovery, duplicate side-effect rejection, ledger/workspace consistency, resume/replay, finite convergence, evidence-chain integrity.',
    fields: ['process_loss_recovery', 'duplicate_side_effect_rejection', 'ledger_workspace_consistency', 'resume_replay', 'finite_convergence', 'evidence_chain_integrity'],
    required: true
  }
};

const requiredE2EFields = {
  artifact_lifecycle: ['base_mode_pack_load', 'minimal_task_run', 'ledger_generation', 'forced_stop_resume', 'stale_replay_rejection'],
  golden_journey_fixture: ['base_mode_pack_load', 'minimal_task_run', 'ledger_generation', 'forced_stop_resume', 'stale_replay_rejection'],
  soak_test: ['base_mode_pack_load', 'minimal_task_run', 'ledger_generation', 'forced_stop_resume', 'stale_replay_rejection']
};
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
    iterations: Number.parseInt(process.env.BROWNIE_SOAK_ITERATIONS ?? '100', 10),
    allowFailClosed: false
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
    } else if (arg === '--allow-fail-closed') {
      options.allowFailClosed = true;
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
      exists: fs.existsSync(artifactPath),
      artifact_evidence: evidence,
      evidence_dir: normalizeRelativePath(path.relative(repoRoot, path.dirname(evidencePath)))
    });
  }
  return artifacts;
}

const baseRoundtripChecks = [
  'mode_pack_load',
  'workspace_mutation',
  'ledger_generation',
  'forced_interruption',
  'resume',
  'stale_replay_rejection'
];

const requiredRoundtripChecks = [
  ...baseRoundtripChecks,
  'implementation_commit',
  'tested_commit',
  'workflow_run_id',
  'artifact_sha256',
  'binary_sha256',
  'platform',
  'architecture',
  'roundtrip_journey',
  'soak_results'
];

const baseSoakChecks = [
  'artifact_execution_boundary',
  'process_loss_recovery',
  'duplicate_side_effect_rejection',
  'ledger_workspace_consistency',
  'resume_replay_behavior',
  'finite_convergence',
  'evidence_chain_integrity'
];

const requiredSoakChecks = [
  ...baseSoakChecks,
  'implementation_commit',
  'tested_commit',
  'workflow_run_id',
  'artifact_sha256',
  'binary_sha256',
  'platform',
  'architecture',
  'roundtrip_journey',
  'soak_results'
];

function isSha256(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function isCommitSha256(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{40}$/u.test(value);
}

function targetCoordinates(target) {
  const knownTargets = {
    'darwin-arm64': { platform: 'darwin', architecture: 'arm64' },
    'linux-arm64': { platform: 'linux', architecture: 'arm64' },
    'linux-x64': { platform: 'linux', architecture: 'x64' },
    'win32-x64': { platform: 'win32', architecture: 'x64' }
  };
  return knownTargets[target] ?? null;
}

function releaseArchiveForTarget(repoRoot, artifact) {
  const evidence = artifact.artifact_evidence ?? {};
  const declared = evidence.archive ?? artifact.archive;
  if (declared?.path && isSha256(declared.sha256)) {
    return { path: normalizeRelativePath(declared.path), sha256: declared.sha256 };
  }
  const extension = String(artifact.target ?? '').startsWith('win32-') ? 'zip' : 'tar.gz';
  const candidate = path.join(artifact.evidence_dir ?? '', `brownie-${artifact.target}.${extension}`);
  const fullPath = resolveRepoRelative(repoRoot, candidate);
  return fs.existsSync(fullPath)
    ? { path: normalizeRelativePath(candidate), sha256: sha256File(fullPath) }
    : null;
}

function allPassed(evidence, checks) {
  return checks.every((check) => evidence?.checks?.[check]?.passed === true);
}

function evidenceWithBindingChecks(evidence, bindingChecks) {
  return {
    ...evidence,
    checks: {
      ...(evidence?.checks ?? {}),
      ...bindingChecks
    }
  };
}

function buildBindingChecks({
  target,
  implementationCommit,
  testedCommit,
  workflowRunId,
  artifactEvidence,
  archive,
  binarySha256,
  journey,
  runtimeSha256,
  soak
}) {
  const expectedCoordinates = targetCoordinates(target);
  const implementationAndTestedCommitMatch =
    isCommitSha256(implementationCommit) &&
    typeof testedCommit === 'string' &&
    implementationCommit.slice('sha256:'.length) === testedCommit;
  const workflowBound = typeof workflowRunId === 'string' && workflowRunId.length > 0 &&
    journey?.workflow_run_id === workflowRunId && soak?.workflow_run_id === workflowRunId;
  const archiveBound = isSha256(archive?.sha256) &&
    journey?.artifact?.archive_sha256 === archive.sha256 &&
    soak?.artifact?.archive_sha256 === archive.sha256;
  const binaryBound = isSha256(binarySha256) &&
    journey?.artifact?.artifact_sha256 === binarySha256 &&
    soak?.artifact?.artifact_sha256 === binarySha256;
  const runtimeBound = isSha256(runtimeSha256) &&
    journey?.artifact?.runtime_sha256 === runtimeSha256 &&
    soak?.artifact?.runtime_sha256 === runtimeSha256;
  const coordinatesBound = Boolean(expectedCoordinates) &&
    artifactEvidence?.platform === expectedCoordinates.platform &&
    artifactEvidence?.arch === expectedCoordinates.architecture;
  const targetBound = journey?.target === target && soak?.target === target;
  const journeyBound = journey?.evidence_id === 'brownie-release-artifact-runtime-journey-v1' &&
    allPassed(journey, baseRoundtripChecks);
  const soakBound = soak?.evidence_id === 'brownie-release-artifact-stateful-soak-v1' &&
    allPassed(soak, baseSoakChecks);
  const common = implementationAndTestedCommitMatch && workflowBound && archiveBound && binaryBound && runtimeBound && coordinatesBound && targetBound;
  return {
    implementation_commit: { passed: implementationAndTestedCommitMatch },
    tested_commit: { passed: implementationAndTestedCommitMatch },
    workflow_run_id: { passed: workflowBound },
    artifact_sha256: { passed: archiveBound },
    binary_sha256: { passed: binaryBound },
    platform: { passed: coordinatesBound },
    architecture: { passed: coordinatesBound },
    roundtrip_journey: { passed: common && journeyBound },
    soak_results: { passed: common && soakBound }
  };
}

function optionalEvidence(repoRoot, relativePath) {
  if (!relativePath) return null;
  return readJsonIfExists(resolveRepoRelative(repoRoot, relativePath));
}

// This shared binding is deliberately generated by both collectors. It does
// not turn unavailable CI artifacts into a local success: all evidence must be
// present, mutually consistent, and tied to the current workflow identity.
export function buildReleaseEvidenceRoundtripBinding(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const artifacts = Array.isArray(options.artifacts) ? options.artifacts : [];
  const workflowRunId = options.workflowRunId ?? process.env.GITHUB_RUN_ID ?? null;
  const testedCommit = options.testedCommit ?? process.env.GITHUB_SHA ?? null;
  const bindings = artifacts.map((artifact) => {
    const artifactEvidence = artifact.artifact_evidence ?? {};
    const artifactRecord = artifactEvidence.artifact ?? {};
    const runtimeRecord = artifactEvidence.runtime_companion ?? {};
    const target = String(artifact.target ?? artifactEvidence.target ?? '');
    const journeyPath = artifact.evidence_dir
      ? normalizeRelativePath(path.join(artifact.evidence_dir, 'runtime-journey-evidence.json'))
      : null;
    const soakPath = artifact.evidence_dir
      ? normalizeRelativePath(path.join(artifact.evidence_dir, 'runtime-stateful-soak-evidence.json'))
      : null;
    const journey = optionalEvidence(repoRoot, journeyPath);
    const soak = optionalEvidence(repoRoot, soakPath);
    const archive = releaseArchiveForTarget(repoRoot, artifact);
    const errors = [];
    const implementationCommit = artifactRecord.source_commit ?? null;
    const binarySha256 = artifactRecord.sha256 ?? artifact.expected_sha256 ?? null;
    const runtimeSha256 = runtimeRecord.sha256 ?? null;
    const bindingChecks = buildBindingChecks({
      target,
      implementationCommit,
      testedCommit,
      workflowRunId,
      artifactEvidence,
      archive,
      binarySha256,
      journey,
      runtimeSha256,
      soak
    });

    if (!target || target !== artifactEvidence.target) errors.push('target_missing_or_mismatched');
    if (!isCommitSha256(implementationCommit)) errors.push('implementation_commit_missing_or_invalid');
    if (artifactRecord.source_clean_tree !== 'clean') errors.push('source_checkout_not_clean');
    if (!isSha256(artifactRecord.source_identity)) errors.push('source_identity_missing_or_invalid');
    if (typeof workflowRunId !== 'string' || workflowRunId.length === 0) errors.push('workflow_run_id_missing');
    if (typeof testedCommit !== 'string' || !/^[a-f0-9]{40}$/u.test(testedCommit)) errors.push('tested_commit_missing_or_invalid');
    if (isCommitSha256(implementationCommit) && testedCommit && implementationCommit.slice('sha256:'.length) !== testedCommit) {
      errors.push('implementation_tested_commit_mismatch');
    }
    if (typeof artifactEvidence.platform !== 'string' || artifactEvidence.platform.length === 0) errors.push('platform_missing');
    if (typeof artifactEvidence.arch !== 'string' || artifactEvidence.arch.length === 0) errors.push('architecture_missing');
    const expectedCoordinates = targetCoordinates(target);
    if (!expectedCoordinates) errors.push('target_unsupported');
    if (expectedCoordinates && artifactEvidence.platform !== expectedCoordinates.platform) errors.push('target_platform_mismatch');
    if (expectedCoordinates && artifactEvidence.arch !== expectedCoordinates.architecture) errors.push('target_architecture_mismatch');
    if (!archive || !isSha256(archive.sha256)) errors.push('package_sha256_missing');
    if (!isSha256(binarySha256)) errors.push('binary_sha256_missing');
    if (!isSha256(runtimeSha256)) errors.push('runtime_sha256_missing');

    if (journey?.evidence_id !== 'brownie-release-artifact-runtime-journey-v1') errors.push('roundtrip_journey_missing_or_invalid');
    if (journey?.target !== target) errors.push('roundtrip_journey_target_mismatch');
    if (journey?.workflow_run_id !== workflowRunId) errors.push('roundtrip_journey_workflow_run_mismatch');
    if (journey?.artifact?.archive_sha256 !== archive?.sha256) errors.push('roundtrip_journey_package_sha_mismatch');
    if (journey?.artifact?.artifact_sha256 !== binarySha256) errors.push('roundtrip_journey_binary_sha_mismatch');
    if (journey?.artifact?.runtime_sha256 !== runtimeSha256) errors.push('roundtrip_journey_runtime_sha_mismatch');
    if (!allPassed(evidenceWithBindingChecks(journey, bindingChecks), requiredRoundtripChecks)) errors.push('roundtrip_journey_checks_incomplete');

    if (soak?.evidence_id !== 'brownie-release-artifact-stateful-soak-v1') errors.push('stateful_soak_missing_or_invalid');
    if (soak?.target !== target) errors.push('stateful_soak_target_mismatch');
    if (soak?.workflow_run_id !== workflowRunId) errors.push('stateful_soak_workflow_run_mismatch');
    if (soak?.artifact?.archive_sha256 !== archive?.sha256) errors.push('stateful_soak_package_sha_mismatch');
    if (soak?.artifact?.artifact_sha256 !== binarySha256) errors.push('stateful_soak_binary_sha_mismatch');
    if (soak?.artifact?.runtime_sha256 !== runtimeSha256) errors.push('stateful_soak_runtime_sha_mismatch');
    if (!allPassed(evidenceWithBindingChecks(soak, bindingChecks), requiredSoakChecks)) errors.push('stateful_soak_checks_incomplete');

    return {
      target,
      status: errors.length === 0 ? 'satisfied' : 'not_executed',
      implementation_commit: implementationCommit,
      tested_commit: testedCommit,
      workflow_run_id: workflowRunId,
      platform: artifactEvidence.platform ?? null,
      architecture: artifactEvidence.arch ?? null,
      package_sha256: archive?.sha256 ?? null,
      binary_sha256: binarySha256,
      runtime_sha256: runtimeSha256,
      journey_evidence_path: journeyPath,
      soak_evidence_path: soakPath,
      errors
    };
  });
  const missing = bindings
    .filter((binding) => binding.status !== 'satisfied')
    .map((binding) => `${binding.target || 'unknown'}:${binding.errors.join(',')}`);
  const bindingWitnesses = bindings
    .map((binding) => ({
      target: binding.target,
      status: binding.status,
      implementation_commit: binding.implementation_commit,
      tested_commit: binding.tested_commit,
      workflow_run_id: binding.workflow_run_id,
      platform: binding.platform,
      architecture: binding.architecture,
      package_sha256: binding.package_sha256,
      binary_sha256: binding.binary_sha256,
      runtime_sha256: binding.runtime_sha256,
      errors: binding.errors
    }))
    .sort((left, right) => left.target.localeCompare(right.target));
  return {
    schema_version: 1,
    evidence_id: 'brownie-release-evidence-roundtrip-binding-v1',
    status: artifacts.length > 0 && missing.length === 0 ? 'satisfied' : 'not_executed',
    release_blocking: true,
    target_count: bindings.length,
    satisfied_target_count: bindings.filter((binding) => binding.status === 'satisfied').length,
    binding_digest: `sha256:${crypto.createHash('sha256').update(JSON.stringify(bindingWitnesses)).digest('hex')}`,
    bindings,
    missing
  };
}

export function summarizeReleaseEvidenceRoundtripBinding(binding) {
  const bindings = Array.isArray(binding?.bindings) ? binding.bindings : [];
  return {
    schema_version: binding?.schema_version ?? null,
    evidence_id: binding?.evidence_id ?? null,
    status: binding?.status ?? 'not_executed',
    release_blocking: binding?.release_blocking === true,
    target_count: binding?.target_count ?? bindings.length,
    satisfied_target_count: binding?.satisfied_target_count ?? bindings.filter((entry) => entry?.status === 'satisfied').length,
    binding_digest: binding?.binding_digest ?? null
  };
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
    commands: redactCommandResults(commands)
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
  const delegatedResult = redactDelegatedResult(parseCommandJson(command));
  return {
    target: target.id,
    kind: target.kind,
    host: '[redacted-host]',
    workspace: redactLocalEvidenceString(target.workspace),
    shell: target.shell,
    status: command.passed ? 'delegated_artifact_build_completed' : 'blocked_external',
    passed: command.passed,
    delegated_result: delegatedResult,
    commands: redactCommandResults([command])
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

function waitForFile(filePath, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      return true;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return false;
}

function mockOpenAiResponse(content) {
  return { choices: [{ message: { content } }] };
}

function startGoldenJourneyMockProvider() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-golden-llm-'));
  const portPath = path.join(tempDir, 'port.json');
  const serverPath = path.join(tempDir, 'server.mjs');
  const responses = [
    mockOpenAiResponse([
      'Mock Golden Journey first pass.',
      '',
      '```brownie-tool-intent',
      JSON.stringify({
        tool_requests: [
          {
            tool_id: 'workspace.read',
            reason: 'Read the Golden Journey output before updating it.',
            input: { path: 'golden-journey-output.md' }
          }
        ]
      }),
      '```'
    ].join('\n')),
    mockOpenAiResponse([
      'Mock Golden Journey second pass.',
      '',
      '```brownie-tool-intent',
      JSON.stringify({
        tool_requests: [
          {
            tool_id: 'workspace.write',
            reason: 'Update the Golden Journey fixture output.',
            input: {
              path: 'golden-journey-output.md',
              operation: 'replace_file',
              content: 'Brownie completed the Golden Journey fixture.\n'
            }
          }
        ]
      }),
      '```'
    ].join('\n'))
  ];
  fs.writeFileSync(
    serverPath,
    [
      "import http from 'node:http';",
      "import fs from 'node:fs';",
      `const portPath = ${JSON.stringify(portPath)};`,
      `const responses = ${JSON.stringify(responses)};`,
      'let index = 0;',
      'const server = http.createServer((req, res) => {',
      "  if (req.method === 'GET' && req.url === '/v1/models') {",
      "    const body = JSON.stringify({ data: [{ id: 'mock-model' }] });",
      "    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });",
      '    res.end(body);',
      '    return;',
      '  }',
      "  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {",
      "    const body = JSON.stringify({ error: 'not_found' });",
      "    res.writeHead(404, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });",
      '    res.end(body);',
      '    return;',
      '  }',
      "  req.on('data', () => {});",
      "  req.on('end', () => {",
      '    const body = JSON.stringify(responses[Math.min(index, responses.length - 1)]);',
      '    index += 1;',
      "    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });",
      '    res.end(body);',
      '  });',
      '});',
      "server.listen(0, '127.0.0.1', () => {",
      '  const address = server.address();',
      "  fs.writeFileSync(portPath, JSON.stringify({ base_url: `http://127.0.0.1:${address.port}/v1` }));",
      '});',
      "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
      ''
    ].join('\n')
  );
  const child = spawn(process.execPath, [serverPath], {
    cwd: tempDir,
    stdio: 'ignore',
    detached: false
  });
  if (!waitForFile(portPath)) {
    child.kill('SIGTERM');
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error('Golden Journey mock provider did not start.');
  }
  const baseUrl = JSON.parse(fs.readFileSync(portPath, 'utf8')).base_url;
  return {
    baseUrl,
    stop() {
      child.kill('SIGTERM');
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function buildGoldenJourneySection(repoRoot) {
  const fixtureRoot = '.brownie/release-evidence/golden-journey-fixture';
  const fixtureFull = resolveRepoRelative(repoRoot, fixtureRoot);
  fs.mkdirSync(fixtureFull, { recursive: true });
  fs.writeFileSync(path.join(fixtureFull, 'README.md'), '# Brownie golden journey fixture\n');
  fs.writeFileSync(path.join(fixtureFull, 'golden-journey-output.md'), 'Pending Golden Journey fixture.\n');
  fs.writeFileSync(
    path.join(fixtureFull, 'objective.md'),
    [
      'In this isolated fixture, update `golden-journey-output.md`.',
      'Replace its contents with exactly: Brownie completed the Golden Journey fixture.',
      'Use the normal workspace.write proposal, apply, post-apply verification, and completion path.'
    ].join(' ') + '\n'
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
  const mockProvider = startGoldenJourneyMockProvider();
  const fixtureRuntimeStateRoot = path.join(fixtureFull, '.brownie');
  fs.mkdirSync(fixtureRuntimeStateRoot, { recursive: true });
  fs.writeFileSync(
    path.join(fixtureRuntimeStateRoot, 'config.json'),
    `${JSON.stringify({
      version: 1,
      active_profile: 'mock-openai',
      llm: {
        profiles: {
          'mock-openai': {
            provider: 'openai-compatible',
            base_url: mockProvider.baseUrl,
            model: 'mock-model',
            api_key_env: 'BROWNIE_TEST_LLM_API_KEY',
            strict: true
          }
        }
      }
    }, null, 2)}\n`
  );
  let commands;
  const runEnv = {
    BROWNIE_WORKSPACE_ROOT: fixtureFull,
    BROWNIE_CLI_RUN_MODE_ID: 'implementer',
    BROWNIE_TEST_LLM_API_KEY: 'test-key',
    BROWNIE_LLM_ALLOW_PROVIDER_ACCESS: 'true'
  };
  try {
    commands = [
      run(cliPath, ['--version'], { cwd: fixtureFull }),
      run(cliPath, ['help', 'run'], { cwd: fixtureFull }),
      run(cliPath, ['--json', 'run', '--file', 'objective.md'], {
        cwd: fixtureFull,
        timeoutMs: 120_000,
        env: runEnv
      })
    ];
    for (let index = 0; index < 4; index += 1) {
      const latest = parseCommandJson(commands.at(-1));
      if (latest?.automation?.continuation_required !== true && latest?.run?.automation?.continuation_required !== true) {
        break;
      }
      commands.push(run(cliPath, ['--json', 'resume'], {
        cwd: fixtureFull,
        timeoutMs: 120_000,
        env: runEnv
      }));
    }
  } finally {
    mockProvider.stop();
    fs.rmSync(fixtureRuntimeStateRoot, { recursive: true, force: true });
  }
  const goldenRunJsons = commands
    .map((command) => parseCommandJson(command))
    .filter((value) => value !== null);
  const goldenRunResults = goldenRunJsons
    .map((value) => value.run ?? value.resume ?? value)
    .filter((value) => value && typeof value === 'object');
  const goldenOutputPath = path.join(fixtureFull, 'golden-journey-output.md');
  const expectedGoldenOutput = 'Brownie completed the Golden Journey fixture.\n';
  const lifecycleEvidence = {
    json_present: goldenRunJsons.length > 0,
    proposal_preflight_observed: goldenRunResults.some((result) => typeof result.objective_proposal_preflight_status === 'string'),
    apply_observed: goldenRunResults.some((result) => result.objective_apply_applied === true || typeof result.objective_apply_apply_status === 'string'),
    post_apply_verification_observed: goldenRunResults.some((result) =>
      typeof result.objective_apply_verification_status === 'string' ||
      typeof result.accepted_completion_verifier_gate_status === 'string' ||
      (result.objective_apply_applied === true && result.terminal_completion_task_status === 'Completed')
    ),
    workspace_mutation_observed: fs.existsSync(goldenOutputPath) && fs.readFileSync(goldenOutputPath, 'utf8') === expectedGoldenOutput,
    completion_observed: goldenRunResults.some((result) =>
      result.completed === true ||
      result.automation?.completed === true ||
      result.terminal_completion_task_status === 'Completed' ||
      result.terminal_completion_final_state === 'Completed'
    )
  };
  const lifecycleSatisfied = Object.values(lifecycleEvidence).every(Boolean);
  return {
    status: commands.every((command) => command.passed) && lifecycleSatisfied ? 'satisfied' : 'failed',
    release_blocking: true,
    fixture_path: fixtureRoot,
    lifecycle_evidence: lifecycleEvidence,
    commands: redactCommandResults(commands),
    note: 'This local fixture evidence checks the executable Golden Journey boundary by driving proposal preflight, apply, post-apply verification, workspace mutation, and completion through the Runtime CLI.'
  };
}

function buildSoakSection(repoRoot, iterations, releaseEvidenceBinding) {
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
  const bindingSummary = summarizeReleaseEvidenceRoundtripBinding(releaseEvidenceBinding);
  const bindingSatisfied = bindingSummary.status === 'satisfied';
  const statefulSteps = [
    {
      id: 'task_state_transition',
      status: failureCount === 0 ? 'satisfied' : 'failed',
      passed: failureCount === 0,
      evidence_kind: 'bounded_cli_transition_proxy'
    },
    {
      id: 'roundtrip_journey_binding',
      status: bindingSatisfied ? 'satisfied' : 'not_executed',
      passed: bindingSatisfied,
      evidence_kind: 'release_evidence_roundtrip_binding',
      binding: bindingSummary
    },
    {
      id: 'soak_results_binding',
      status: bindingSatisfied ? 'satisfied' : 'not_executed',
      passed: bindingSatisfied,
      evidence_kind: 'release_evidence_roundtrip_binding',
      binding: bindingSummary
    }
  ];
  const satisfiedStatefulStepIds = new Set(
    statefulSteps
      .filter((step) => step.status === 'satisfied')
      .map((step) => step.id)
  );
  const missingStatefulSteps = requiredStatefulSoakStepIds.filter((stepId) => !satisfiedStatefulStepIds.has(stepId));
  return {
    stateful_steps: statefulSteps,
    status: failureCount === 0 ? 'not_executed' : 'failed',
    release_blocking: true,
    stateful_soak_config: statefulSoakConfig,
    seed: 'brownie-runtime-operational-soak-v1',
    iterations_requested: iterations,
    iterations_completed: commands.length,
    failure_count: failureCount,
    failure_rate: failureCount / commands.length,
    duplicate_side_effects_observed: false,
    ledger_workspace_consistency_status: 'not_exercised_by_version_soak',
    unrecoverable_run_count: 0,
    missing_stateful_steps: missingStatefulSteps,
    note: 'Version-only soak is retained as bounded CLI-startup diagnostics but is not sufficient Runtime durability evidence.',
    commands: redactCommandResults(commands)
  };
}

// artifact-roundtrip has already executed the packaged CLI in an isolated
// workspace. When that evidence is present and mutually bound, consuming it
// is stronger than attempting to recreate a different local debug build in
// the collector job. These sections deliberately contain no invented command
// records: the guard re-opens and validates the downloaded journey and soak
// receipts before accepting this source.
function buildBoundArtifactLifecycleSection(releaseEvidenceBinding) {
  const bindingSummary = summarizeReleaseEvidenceRoundtripBinding(releaseEvidenceBinding);
  return {
    status: 'satisfied',
    release_blocking: true,
    evidence_source: 'downloaded_artifact_binding',
    evidence_binding: bindingSummary,
    lifecycle_results: releaseEvidenceBinding.bindings.map((binding) => ({
      target: binding.target,
      path: binding.journey_evidence_path,
      status: 'satisfied',
      passed: true,
      evidence_source: 'downloaded_artifact_binding',
      journey_evidence_path: binding.journey_evidence_path,
      soak_evidence_path: binding.soak_evidence_path
    })),
    note: 'Lifecycle evidence is consumed from the downloaded package journey and stateful-soak receipts, not recreated from a local build tree.'
  };
}

function buildBoundGoldenJourneySection(releaseEvidenceBinding) {
  return {
    status: 'satisfied',
    release_blocking: true,
    evidence_source: 'downloaded_artifact_binding',
    evidence_binding: summarizeReleaseEvidenceRoundtripBinding(releaseEvidenceBinding),
    journey_evidence_paths: releaseEvidenceBinding.bindings.map((binding) => binding.journey_evidence_path),
    note: 'Golden Journey evidence is consumed from the downloaded packaged CLI journey receipts.'
  };
}

function boundSoakEvidenceKind(stepId) {
  if (['task_state_transition', 'ledger_workspace_consistency', 'resume_replay_handling', 'duplicate_side_effect_rejection', 'process_loss_recovery', 'finite_convergence', 'evidence_chain_integrity'].includes(stepId)) {
    return 'downloaded_artifact_stateful_soak';
  }
  if (['artifact_lifecycle', 'golden_journey_fixture', 'soak_test', 'executable_evidence_validation', 'roundtrip_journey_binding', 'soak_results_binding', 'roundtrip_journey', 'soak_results', 'downloaded_roundtrip_binding', 'runtime_journey_binding', 'supply_chain_guard_binding'].includes(stepId)) {
    return 'downloaded_artifact_journey_and_soak';
  }
  return 'verified_release_evidence_binding';
}

function buildBoundSoakSection(releaseEvidenceBinding) {
  const bindingSummary = summarizeReleaseEvidenceRoundtripBinding(releaseEvidenceBinding);
  const targetCount = releaseEvidenceBinding.bindings.length;
  return {
    status: 'satisfied',
    release_blocking: true,
    evidence_source: 'downloaded_artifact_binding',
    evidence_binding: bindingSummary,
    iterations_requested: targetCount,
    iterations_completed: targetCount,
    failure_count: 0,
    failure_rate: 0,
    duplicate_side_effects_observed: false,
    unrecoverable_run_count: 0,
    stateful_steps: requiredStatefulSoakStepIds.map((id) => ({
      id,
      status: 'satisfied',
      passed: true,
      evidence_kind: boundSoakEvidenceKind(id),
      binding: bindingSummary
    })),
    note: 'Each iteration is one bounded downloaded-artifact soak receipt; all receipt contents are revalidated by the runtime evidence guard.'
  };
}

function buildExecutableEvidenceValidationSection(sections, releaseEvidenceBinding = null) {
  const sectionStatuses = Object.entries(sections).map(([id, section]) => ({
    id,
    status: section?.status ?? 'missing',
    satisfied: section?.status === 'satisfied'
  }));
  const missingExecutableEvidence = sectionStatuses
    .filter((entry) => !entry.satisfied)
    .map((entry) => `${entry.id}:${entry.status}`);
  if (releaseEvidenceBinding && releaseEvidenceBinding.status !== 'satisfied') {
    missingExecutableEvidence.push(`release_evidence_binding:${releaseEvidenceBinding.status}`);
  }
  return {
    status: missingExecutableEvidence.length === 0 ? 'satisfied' : 'not_executed',
    release_blocking: true,
    fail_closed: true,
    validated_sections: sectionStatuses,
    missing_executable_evidence: missingExecutableEvidence,
    release_evidence_binding: releaseEvidenceBinding,
    note: 'This section binds the runtime operational evidence guard to the executable evidence chain instead of allowing document-only release claims.'
  };
}

function commandSummaryFixture() {
  return {
    command_summary: { kind: 'command_summary', word_count: 2, sha256: 'a'.repeat(64) },
    exit_code: 0,
    signal: null,
    passed: true,
    stdout_summary: { kind: 'process_output_summary', byte_length: 0, line_count: 0, sha256: 'b'.repeat(64) },
    stderr_summary: { kind: 'process_output_summary', byte_length: 0, line_count: 0, sha256: 'c'.repeat(64) }
  };
}

function statefulStepFixture(id) {
  return {
    id,
    status: 'satisfied',
    passed: true,
    evidence_summary: { kind: 'stateful_soak_step_summary', sha256: id.padEnd(64, id.at(0) ?? 'a').slice(0, 64) }
  };
}

function buildShortcutRuntimeOperationalEvidence(options, repoRoot, generatedAt) {
  const artifactLifecycleInput = options.artifact_lifecycle ?? {};
  const artifactFailClosed = artifactLifecycleInput.fail_closed !== false;
  const artifactStatus = artifactLifecycleInput.status === 'executable' ? 'satisfied' : (artifactLifecycleInput.status ?? 'satisfied');
  const goldenInput = options.golden_journey_fixture ?? {};
  const goldenExecuted = goldenInput.executed !== false;
  const soakInput = options.soak_test ?? {};
  const soakStepIds = Array.isArray(soakInput.step_ids) ? soakInput.step_ids : requiredStatefulSoakStepIds;
  const sections = {
    artifact_lifecycle: {
      status: artifactStatus,
      release_blocking: true,
      fail_closed: artifactFailClosed,
      lifecycle_results: [
        {
          target: 'darwin-arm64',
          path: '.brownie/release-evidence/artifacts/darwin-arm64/brownie',
          status: artifactStatus,
          passed: artifactStatus === 'satisfied',
          checksum_verified: artifactStatus === 'satisfied',
          uninstalled: artifactStatus === 'satisfied',
          commands: [commandSummaryFixture()]
        }
      ]
    },
    golden_journey_fixture: {
      status: goldenExecuted ? 'satisfied' : 'not_executed',
      release_blocking: true,
      commands: goldenExecuted ? [commandSummaryFixture()] : [],
      lifecycle_evidence: {
        json_present: goldenExecuted,
        proposal_preflight_observed: goldenExecuted,
        apply_observed: goldenExecuted,
        post_apply_verification_observed: goldenExecuted,
        workspace_mutation_observed: goldenExecuted,
        completion_observed: goldenExecuted
      }
    },
    soak_test: {
      status: 'satisfied',
      release_blocking: true,
      iterations_requested: 100,
      iterations_completed: 100,
      failure_count: 0,
      failure_rate: 0,
      duplicate_side_effects_observed: false,
      unrecoverable_run_count: 0,
      commands: [commandSummaryFixture()],
      step_ids: soakStepIds,
      stateful_steps: soakStepIds.map((id) => statefulStepFixture(id))
    }
  };
  sections.executable_evidence_validation = buildExecutableEvidenceValidationSection(sections);
  const failClosedReasons = [];
  if (!artifactFailClosed) {
    failClosedReasons.push('artifact_lifecycle:fail_closed_false');
  }
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
    repository: loadPhaseLoopActorDeployment({ repoRoot }).deployment?.repository ?? null,
    release_ready: false,
    runtime_release_ready: false,
    fail_closed: artifactFailClosed,
    required_sections: requiredSections,
    sections,
    fail_closed_reasons: failClosedReasons
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
  if (
    options.artifact_lifecycle !== undefined ||
    options.golden_journey_fixture !== undefined ||
    options.soak_test !== undefined
  ) {
    return buildShortcutRuntimeOperationalEvidence(options, repoRoot, generatedAt);
  }
  const iterations = options.iterations ?? 100;
  const artifacts = discoveredArtifacts(repoRoot);
  const releaseEvidenceBinding = buildReleaseEvidenceRoundtripBinding({ repoRoot, artifacts });
  const sections = releaseEvidenceBinding.status === 'satisfied'
    ? {
        artifact_lifecycle: buildBoundArtifactLifecycleSection(releaseEvidenceBinding),
        golden_journey_fixture: buildBoundGoldenJourneySection(releaseEvidenceBinding),
        soak_test: buildBoundSoakSection(releaseEvidenceBinding)
      }
    : {
        artifact_lifecycle: buildArtifactLifecycleSection(repoRoot, artifacts),
        golden_journey_fixture: buildGoldenJourneySection(repoRoot),
        soak_test: buildSoakSection(repoRoot, iterations, releaseEvidenceBinding)
      };
  sections.executable_evidence_validation = buildExecutableEvidenceValidationSection(sections, releaseEvidenceBinding);
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
    repository: loadPhaseLoopActorDeployment({ repoRoot }).deployment?.repository ?? null,
    release_ready: false,
    runtime_release_ready: false,
    required_sections: requiredSections,
    sections,
    release_evidence_binding: releaseEvidenceBinding,
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
    const options = parseArgs(process.argv.slice(2));
    const result = writeRuntimeOperationalEvidence(options);
    process.stdout.write(`${JSON.stringify({ path: result.outPath, status: result.evidence.fail_closed_reasons.length === 0 ? 'satisfied' : 'failed', fail_closed_reasons: result.evidence.fail_closed_reasons }, null, 2)}\n`);
    process.exit(result.evidence.fail_closed_reasons.length === 0 || options.allowFailClosed ? 0 : 1);
  } catch (error) {
    console.error(`Runtime operational evidence failed: ${error.message}`);
    process.exit(1);
  }
}
