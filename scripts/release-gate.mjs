import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');

export const requiredReleaseGateCommands = [
  {
    id: 'rust_fmt',
    category: 'rust_quality',
    command: 'cargo',
    args: ['fmt', '--all', '--', '--check']
  },
  {
    id: 'rust_check',
    category: 'rust_quality',
    command: 'cargo',
    args: ['check', '--workspace', '--all-targets', '--all-features']
  },
  {
    id: 'rust_clippy',
    category: 'rust_quality',
    command: 'cargo',
    args: ['clippy', '--workspace', '--all-targets', '--all-features', '--', '-D', 'warnings']
  },
  {
    id: 'rust_test',
    category: 'rust_quality',
    command: 'cargo',
    args: ['test', '--workspace', '--all-features']
  },
  {
    id: 'pnpm_install_frozen',
    category: 'node_quality',
    command: 'pnpm',
    args: ['install', '--frozen-lockfile']
  },
  {
    id: 'node_check',
    category: 'node_quality',
    command: 'pnpm',
    args: ['--workspace-root', 'check']
  },
  {
    id: 'node_test',
    category: 'node_quality',
    command: 'pnpm',
    args: ['--workspace-root', 'test']
  },
  {
    id: 'node_build',
    category: 'node_quality',
    command: 'pnpm',
    args: ['--workspace-root', 'build']
  },
  {
    id: 'release_contract_guard',
    category: 'brownie_release_guard',
    command: 'pnpm',
    args: ['--workspace-root', 'guard:release-contract']
  },
  {
    id: 'release_contract_guard_test',
    category: 'brownie_release_guard',
    command: 'pnpm',
    args: ['--workspace-root', 'guard:release-contract:test']
  },
  {
    id: 'runtime_release_readiness_guard',
    category: 'brownie_release_guard',
    command: 'pnpm',
    args: ['--workspace-root', 'guard:runtime-release-readiness']
  },
  {
    id: 'product_completion_guard',
    category: 'brownie_release_guard',
    command: 'pnpm',
    args: ['--workspace-root', 'guard:product-completion']
  },
  {
    id: 'phase_value_guard',
    category: 'brownie_release_guard',
    command: 'pnpm',
    args: ['--workspace-root', 'guard:phase-value']
  },
  {
    id: 'durable_schema_migration_guard',
    category: 'brownie_release_guard',
    command: 'pnpm',
    args: ['--workspace-root', 'guard:durable-schema-migration']
  },
  {
    id: 'protocol_event_canonization_guard',
    category: 'brownie_release_guard',
    command: 'pnpm',
    args: ['--workspace-root', 'guard:protocol-event-canonization']
  },
  {
    id: 'runtime_module_decomposition_guard',
    category: 'brownie_release_guard',
    command: 'pnpm',
    args: ['--workspace-root', 'guard:runtime-module-decomposition']
  },
  {
    id: 'platform_deadline_durability_guard',
    category: 'brownie_release_guard',
    command: 'pnpm',
    args: ['--workspace-root', 'guard:platform-deadline-durability']
  },
  {
    id: 'rrp3_process_loss_e2e',
    category: 'brownie_recovery_regression',
    command: 'pnpm',
    args: ['--workspace-root', 'test:rrp3-process-loss']
  }
];

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    repoRoot: defaultRepoRoot,
    evidencePath: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--repo-root') {
      options.repoRoot = path.resolve(argv[++index] ?? '');
    } else if (arg === '--evidence') {
      options.evidencePath = path.resolve(argv[++index] ?? '');
    } else {
      throw new Error(`Unknown release-gate argument: ${arg}`);
    }
  }
  return options;
}

function gitValue(repoRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

function runCommand(repoRoot, entry) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(entry.command, entry.args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, CARGO_TERM_COLOR: 'never' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return {
    id: entry.id,
    category: entry.category,
    command: [entry.command, ...entry.args].join(' '),
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    exit_code: result.status,
    passed: result.status === 0,
    stdout_tail: (result.stdout ?? '').slice(-4000),
    stderr_tail: (result.stderr ?? '').slice(-4000)
  };
}

export function buildReleaseGatePlan(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  return {
    schema_version: 1,
    gate_id: 'brownie-runtime-release-gate-v1',
    repo_root: repoRoot,
    commit: gitValue(repoRoot, ['rev-parse', 'HEAD']),
    commands: requiredReleaseGateCommands.map((entry) => ({
      id: entry.id,
      category: entry.category,
      command: [entry.command, ...entry.args].join(' ')
    }))
  };
}

export function runReleaseGate(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const evidence = {
    ...buildReleaseGatePlan({ repoRoot }),
    started_at: new Date().toISOString(),
    finished_at: null,
    release_ready: false,
    command_results: []
  };

  for (const entry of requiredReleaseGateCommands) {
    const result = runCommand(repoRoot, entry);
    evidence.command_results.push(result);
    if (!result.passed) {
      break;
    }
  }

  evidence.finished_at = new Date().toISOString();
  evidence.release_ready =
    evidence.command_results.length === requiredReleaseGateCommands.length &&
    evidence.command_results.every((result) => result.passed);
  return evidence;
}

if (isMainModule()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const evidence = options.dryRun
      ? buildReleaseGatePlan({ repoRoot: options.repoRoot })
      : runReleaseGate({ repoRoot: options.repoRoot });
    const output = `${JSON.stringify(evidence, null, 2)}\n`;
    if (options.evidencePath) {
      fs.mkdirSync(path.dirname(options.evidencePath), { recursive: true });
      fs.writeFileSync(options.evidencePath, output);
    }
    process.stdout.write(output);
    if (!options.dryRun && evidence.release_ready !== true) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`Release gate failed before execution: ${error.message}`);
    process.exit(1);
  }
}
