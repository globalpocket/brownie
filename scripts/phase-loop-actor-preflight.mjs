import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultPolicyPath = 'docs/architecture/phase-loop-actor-separation-policy.json';

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function parseArgs(argv) {
  const options = {
    role: null,
    repoRoot: defaultRepoRoot,
    policyPath: defaultPolicyPath
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--role') {
      options.role = argv[++index] ?? null;
    } else if (arg === '--repo-root') {
      options.repoRoot = path.resolve(argv[++index] ?? '');
    } else if (arg === '--policy') {
      options.policyPath = argv[++index] ?? '';
    } else {
      throw new Error(`Unknown phase-loop actor preflight argument: ${arg}`);
    }
  }
  return options;
}

function run(repoRoot, command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    passed: result.status === 0
  };
}

function readJson(repoRoot, relativePath, errors) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
  } catch (error) {
    errors.push(`${relativePath} must be readable JSON: ${error.message}`);
    return {};
  }
}

function parseRepository(remoteUrl) {
  if (typeof remoteUrl !== 'string' || remoteUrl.trim() === '') {
    return null;
  }
  const sshMatch = remoteUrl.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }
  try {
    const url = new URL(remoteUrl);
    if (url.hostname !== 'github.com') {
      return null;
    }
    const parts = url.pathname.replace(/^\/|\.git$/g, '').split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  } catch {
    return null;
  }
}

function commandStdout(repoRoot, command, args) {
  const result = run(repoRoot, command, args);
  return result.passed ? result.stdout.trim() : null;
}

function expectedActorForRole(policy, role) {
  if (role === 'implementation') {
    return policy.implementation_actor;
  }
  if (role === 'review' || role === 'merge') {
    return role === 'review' ? policy.review_actor : policy.merge_actor;
  }
  return null;
}

function branchPrefixesForRole(policy, role) {
  if (role === 'implementation') {
    return Array.isArray(policy.implementation_branch_prefixes) ? policy.implementation_branch_prefixes : [];
  }
  if (role === 'review' || role === 'merge') {
    return Array.isArray(policy.review_branch_prefixes) ? policy.review_branch_prefixes : [];
  }
  return [];
}

export function validatePhaseLoopActorPreflight(state, options = {}) {
  const errors = [];
  const role = options.role;
  const policy = options.policy ?? {};
  const expectedActor = expectedActorForRole(policy, role);
  const forbiddenActors = new Set(
    role === 'implementation'
      ? [policy.review_actor, policy.merge_actor].filter(Boolean)
      : [policy.implementation_actor].filter(Boolean)
  );

  if (!['implementation', 'review', 'merge'].includes(role)) {
    errors.push('role must be implementation, review, or merge.');
  }
  if (!expectedActor) {
    errors.push(`policy must define an expected actor for role ${role ?? '(missing)'}.`);
  }
  if (state.repository !== policy.repository) {
    errors.push(`remote origin must resolve to ${policy.repository}; got ${state.repository ?? '(unknown)'}.`);
  }
  if (!state.githubActor) {
    errors.push('authenticated GitHub actor must be available via gh api user.');
  } else if (state.githubActor !== expectedActor) {
    errors.push(`${role} role must use GitHub actor ${expectedActor}; got ${state.githubActor}.`);
  }
  if (state.githubActor && forbiddenActors.has(state.githubActor)) {
    errors.push(`${role} role must not run under forbidden actor ${state.githubActor}.`);
  }

  if (role === 'implementation') {
    if (!state.branch || state.branch === 'main') {
      errors.push('implementation role must run from a non-main implementation branch.');
    }
    const prefixes = branchPrefixesForRole(policy, role);
    if (state.branch && prefixes.length > 0 && !prefixes.some((prefix) => state.branch.startsWith(prefix))) {
      errors.push(`implementation branch ${state.branch} must start with one of: ${prefixes.join(', ')}.`);
    }
  }

  return errors;
}

export function collectPhaseLoopActorState(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const remoteUrl = commandStdout(repoRoot, 'git', ['config', '--get', 'remote.origin.url']);
  return {
    repository: parseRepository(remoteUrl),
    remoteUrlPresent: Boolean(remoteUrl),
    branch: commandStdout(repoRoot, 'git', ['branch', '--show-current']),
    head: commandStdout(repoRoot, 'git', ['rev-parse', 'HEAD']),
    githubActor: commandStdout(repoRoot, 'gh', ['api', 'user', '--jq', '.login'])
  };
}

export function runPhaseLoopActorPreflight(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const policyPath = options.policyPath ?? defaultPolicyPath;
  const errors = [];
  const policy = options.policy ?? readJson(repoRoot, policyPath, errors);
  const state = options.state ?? collectPhaseLoopActorState({ repoRoot });
  errors.push(...validatePhaseLoopActorPreflight(state, { role: options.role, policy }));
  return { errors, policyPath, role: options.role, state };
}

if (isMainModule()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = runPhaseLoopActorPreflight(options);
    if (result.errors.length > 0) {
      console.error('Phase-loop actor preflight failed:');
      for (const error of result.errors) {
        console.error(`- ${error}`);
      }
      process.exit(1);
    }
    process.stdout.write(
      `${JSON.stringify({ policy: result.policyPath, role: result.role, actor: result.state.githubActor, branch: result.state.branch, status: 'passed' }, null, 2)}\n`
    );
  } catch (error) {
    console.error(`Phase-loop actor preflight failed: ${error.message}`);
    process.exit(1);
  }
}
