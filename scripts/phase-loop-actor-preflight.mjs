import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  loadPhaseLoopActorCredentials,
  loadPhaseLoopActorDeployment,
  roleActor,
  roleBranchPrefixes,
  roleCredentialProfile
} from './phase-loop-actor-deployment.mjs';

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
    policyPath: defaultPolicyPath,
    deploymentPath: null,
    credentialsPath: null,
    credentialsRoot: null,
    printGhConfigDir: false
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
    } else if (arg === '--deployment') {
      options.deploymentPath = argv[++index] ?? null;
    } else if (arg === '--credentials') {
      options.credentialsPath = argv[++index] ?? null;
    } else if (arg === '--credentials-root') {
      options.credentialsRoot = path.resolve(argv[++index] ?? '');
    } else if (arg === '--print-gh-config-dir') {
      options.printGhConfigDir = true;
    } else {
      throw new Error(`Unknown phase-loop actor preflight argument: ${arg}`);
    }
  }
  return options;
}

function run(repoRoot, command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
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

function commandStdout(repoRoot, command, args, env) {
  const result = run(repoRoot, command, args, env);
  return result.passed ? result.stdout.trim() : null;
}

// Resolve an account profile without ever reading its token file. The deployment
// names principals by role; local credentials only map that role to a profile.
// No GitHub login or credential directory is inferred from source-code defaults.
export function resolvePhaseLoopGitHubProfile(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const role = options.role;
  const env = options.env ?? process.env;
  const credentialsResult = options.credentialsResult ?? loadPhaseLoopActorCredentials({
    repoRoot,
    env,
    credentials: options.credentials,
    credentialsPath: options.credentialsPath,
    credentialsRoot: options.credentialsRoot
  });
  if (!credentialsResult.ok) {
    return { ok: false, code: 'actor_credentials_unavailable', message: credentialsResult.errors.join(' ') };
  }
  const selected = roleCredentialProfile(options.credentialsRoot ?? repoRoot, credentialsResult.credentials, role);
  if (!selected.ok) return selected;
  return {
    ok: true,
    profile_id: selected.profileId,
    github_config_dir: selected.githubConfigDir,
    env: selected.githubConfigDir ? { ...env, GH_CONFIG_DIR: selected.githubConfigDir } : { ...env }
  };
}

// An empty value is meaningful: it preserves the explicitly configured
// host-default profile instead of inventing a repository-private directory.
// Callers that export this value as GH_CONFIG_DIR therefore keep the host
// selection unchanged, while repository-private profiles remain pinned.
export function phaseLoopGitHubConfigDirForShell(profile) {
  return String(profile?.github_config_dir ?? '');
}

export function validatePhaseLoopActorPreflight(state, options = {}) {
  const errors = [];
  const role = options.role;
  const deployment = options.deployment ?? {};
  const expectedActor = roleActor(deployment, role);
  const forbiddenActors = new Set(
    role === 'implementation'
      ? [roleActor(deployment, 'review'), roleActor(deployment, 'merge')].filter(Boolean)
      : [roleActor(deployment, 'implementation')].filter(Boolean)
  );

  if (!['implementation', 'review', 'merge'].includes(role)) {
    errors.push('role must be implementation, review, or merge.');
  }
  if (!expectedActor) {
    errors.push(`policy must define an expected actor for role ${role ?? '(missing)'}.`);
  }
  if (state.repository !== deployment.repository) {
    errors.push(`remote origin must resolve to ${deployment.repository ?? '(configured repository missing)'}; got ${state.repository ?? '(unknown)'}.`);
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
    const prefixes = roleBranchPrefixes(deployment, role);
    if (state.branch && prefixes.length > 0 && !prefixes.some((prefix) => state.branch.startsWith(prefix))) {
      errors.push(`implementation branch ${state.branch} must start with one of: ${prefixes.join(', ')}.`);
    }
  }

  return errors;
}

export function collectPhaseLoopActorState(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const profile = options.profile ?? { ok: true, env: options.env ?? process.env, profile_id: 'unspecified', github_config_dir: null };
  const commandEnv = profile.env ?? options.env ?? process.env;
  const remoteUrl = commandStdout(repoRoot, 'git', ['config', '--get', 'remote.origin.url'], commandEnv);
  return {
    repository: parseRepository(remoteUrl),
    remoteUrlPresent: Boolean(remoteUrl),
    branch: commandStdout(repoRoot, 'git', ['branch', '--show-current'], commandEnv),
    head: commandStdout(repoRoot, 'git', ['rev-parse', 'HEAD'], commandEnv),
    githubActor: profile.ok === false ? null : commandStdout(repoRoot, 'gh', ['api', 'user', '--jq', '.login'], commandEnv),
    githubProfile: profile.profile_id ?? 'unspecified'
  };
}

export function runPhaseLoopActorPreflight(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const policyPath = options.policyPath ?? defaultPolicyPath;
  const errors = [];
  const policy = options.policy ?? readJson(repoRoot, policyPath, errors);
  const deploymentResult = options.deploymentResult ?? loadPhaseLoopActorDeployment({
    repoRoot,
    env: options.env,
    deployment: options.deployment,
    deploymentPath: options.deploymentPath
  });
  if (!deploymentResult.ok) errors.push(...deploymentResult.errors);
  const deployment = deploymentResult.deployment ?? {};
  const profile = options.profile ?? resolvePhaseLoopGitHubProfile({
    repoRoot,
    role: options.role,
    env: options.env,
    credentials: options.credentials,
    credentialsPath: options.credentialsPath,
    credentialsRoot: options.credentialsRoot
  });
  if (profile.ok === false) errors.push(profile.message);
  const state = options.state ?? collectPhaseLoopActorState({ repoRoot, profile, env: options.env });
  errors.push(...validatePhaseLoopActorPreflight(state, { role: options.role, deployment }));
  return { errors, policyPath, role: options.role, state, profile, deployment: deploymentResult };
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
    if (options.printGhConfigDir) {
      process.stdout.write(`${phaseLoopGitHubConfigDirForShell(result.profile)}\n`);
      process.exit(0);
    }
    process.stdout.write(
      `${JSON.stringify({ policy: result.policyPath, role: result.role, actor: result.state.githubActor, profile: result.profile.profile_id, branch: result.state.branch, status: 'passed' }, null, 2)}\n`
    );
  } catch (error) {
    console.error(`Phase-loop actor preflight failed: ${error.message}`);
    process.exit(1);
  }
}
