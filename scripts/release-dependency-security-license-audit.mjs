import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultOutPath = '.brownie/release-evidence/dependency-security-license-audit.json';

const requiredLockfiles = ['Cargo.lock', 'pnpm-lock.yaml'];
const requiredChecks = [
  {
    id: 'cargo_audit_locked',
    command: 'cargo',
    args: ['audit', '--locked'],
    probe: ['cargo-audit', ['--version']],
    category: 'rust_vulnerability_audit'
  },
  {
    id: 'cargo_deny_policy',
    command: 'cargo',
    args: ['deny', 'check'],
    probe: ['cargo-deny', ['--version']],
    category: 'rust_license_advisory_policy'
  },
  {
    id: 'pnpm_audit_prod',
    command: 'pnpm',
    args: ['audit', '--prod', '--audit-level', 'moderate', '--json'],
    probe: ['pnpm', ['--version']],
    category: 'node_vulnerability_audit'
  }
];

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function parseArgs(argv) {
  const options = {
    repoRoot: defaultRepoRoot,
    outPath: defaultOutPath
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo-root') {
      options.repoRoot = path.resolve(argv[++index] ?? '');
    } else if (arg === '--out') {
      options.outPath = argv[++index] ?? '';
    } else {
      throw new Error(`Unknown dependency audit argument: ${arg}`);
    }
  }
  return options;
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function repoPath(repoRoot, relativePath) {
  return path.join(repoRoot, relativePath);
}

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function defaultRunner(repoRoot, command, args) {
  const timeoutMs = Number.parseInt(process.env.BROWNIE_DEPENDENCY_AUDIT_TIMEOUT_MS ?? '30000', 10);
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, CARGO_TERM_COLOR: 'never' },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000
  });
}

function runChecked(repoRoot, runner, id, command, args) {
  const startedAt = new Date().toISOString();
  const result = runner(repoRoot, command, args);
  return {
    id,
    command: [command, ...args].join(' '),
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    exit_code: result.status ?? null,
    signal: result.signal ?? null,
    timed_out: result.error?.code === 'ETIMEDOUT',
    passed: result.status === 0
  };
}

function lockfileEvidence(repoRoot) {
  return requiredLockfiles.map((relativePath) => {
    const fullPath = repoPath(repoRoot, relativePath);
    return {
      path: relativePath,
      present: fs.existsSync(fullPath),
      sha256: fs.existsSync(fullPath) ? sha256File(fullPath) : null
    };
  });
}

function statusFromCheck(check) {
  if (check.timed_out === true) {
    return 'timed_out';
  }
  if (check.available !== true) {
    return 'tool_unavailable';
  }
  return check.passed === true ? 'satisfied' : 'failed';
}

export function buildDependencySecurityLicenseAudit(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runner = options.runner ?? defaultRunner;
  const sourceCommit =
    options.sourceCommit ??
    (() => {
      const result = runner(repoRoot, 'git', ['rev-parse', 'HEAD']);
      return result.status === 0 ? result.stdout?.trim() ?? null : null;
    })();

  const denyConfigPath = 'deny.toml';
  const denyConfig = repoPath(repoRoot, denyConfigPath);
  const lockfiles = lockfileEvidence(repoRoot);
  const checks = requiredChecks.map((entry) => {
    const [probeCommand, probeArgs] = entry.probe;
    const probe = runChecked(repoRoot, runner, `${entry.id}_probe`, probeCommand, probeArgs);
    const execution = probe.passed
      ? runChecked(repoRoot, runner, entry.id, entry.command, entry.args)
      : null;
    const check = {
      id: entry.id,
      category: entry.category,
      command: [entry.command, ...entry.args].join(' '),
      available: probe.passed,
      passed: execution?.passed ?? false,
      exit_code: execution?.exit_code ?? null,
      timed_out: probe.timed_out === true || execution?.timed_out === true,
      status: null,
      release_blocking: true
    };
    check.status = statusFromCheck(check);
    return check;
  });

  const policy = {
    cargo_deny_config: {
      path: denyConfigPath,
      present: fs.existsSync(denyConfig),
      sha256: fs.existsSync(denyConfig) ? sha256File(denyConfig) : null
    }
  };

  const failClosedReasons = [];
  for (const lockfile of lockfiles) {
    if (!lockfile.present) {
      failClosedReasons.push(`lockfile:${lockfile.path}:missing`);
    }
  }
  if (!policy.cargo_deny_config.present) {
    failClosedReasons.push('cargo_deny_config:missing');
  }
  for (const check of checks) {
    if (check.status !== 'satisfied') {
      failClosedReasons.push(`${check.id}:${check.status}`);
    }
  }

  const mandatoryGatePassed = failClosedReasons.length === 0;
  return {
    schema_version: 1,
    evidence_id: 'brownie-dependency-security-license-audit-v1',
    phase: 'RRP-8.5',
    repository: 'globalpocket/brownie',
    generated_at: generatedAt,
    source_commit: sourceCommit,
    release_ready: false,
    runtime_release_ready: false,
    mandatory_gate_passed: mandatoryGatePassed,
    required_checks: requiredChecks.map((entry) => entry.id),
    lockfiles,
    policy,
    checks,
    fail_closed_reasons: failClosedReasons,
    privacy_policy: 'No raw process output, absolute path, secret, environment value, or file content is stored.'
  };
}

export function writeDependencySecurityLicenseAudit(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const outPath = normalizeRelativePath(options.outPath ?? defaultOutPath);
  const audit = buildDependencySecurityLicenseAudit({ ...options, repoRoot });
  const fullPath = repoPath(repoRoot, outPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(audit, null, 2)}\n`);
  return { audit, outPath };
}

if (isMainModule()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = writeDependencySecurityLicenseAudit(options);
    process.stdout.write(
      `${JSON.stringify(
        {
          path: result.outPath,
          mandatory_gate_passed: result.audit.mandatory_gate_passed,
          fail_closed_reasons: result.audit.fail_closed_reasons
        },
        null,
        2
      )}\n`
    );
    if (result.audit.mandatory_gate_passed !== true) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`Dependency/security/license audit failed: ${error.message}`);
    process.exit(1);
  }
}
