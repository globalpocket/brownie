import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  phaseLoopGitHubConfigDirForShell,
  resolvePhaseLoopGitHubProfile,
  validatePhaseLoopActorPreflight
} from './phase-loop-actor-preflight.mjs';

const deployment = {
  schema_version: 1,
  repository: 'example-org/example-repo',
  roles: {
    implementation: { github_login: 'implementation-bot', branch_prefixes: ['automation/'] },
    review: { github_login: 'reviewer-a' },
    merge: { github_login: 'release-manager' }
  },
  constraints: { require_independent_review: true }
};

const credentials = {
  schema_version: 1,
  roles: {
    implementation: { kind: 'repository-private', github_config_dir: 'profiles/implementation' },
    review: { kind: 'host-default' },
    merge: { kind: 'host-default' }
  }
};

test('implementation resolves the configured repository-private profile, not a login-derived default', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-profile-'));
  try {
    fs.mkdirSync(path.join(repo, '.brownie/private/profiles/implementation'), { recursive: true });
    const profile = resolvePhaseLoopGitHubProfile({ repoRoot: repo, role: 'implementation', credentials });
    assert.equal(profile.ok, true);
    assert.equal(profile.profile_id, 'private-implementation');
    assert.equal(profile.github_config_dir, path.join(repo, '.brownie/private/profiles/implementation'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('review host-default preserves the configured profile without inventing a private directory', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-profile-'));
  try {
    const profile = resolvePhaseLoopGitHubProfile({ repoRoot: repo, role: 'review', credentials });
    assert.equal(profile.ok, true);
    assert.equal(profile.profile_id, 'host-default');
    assert.equal(profile.github_config_dir, null);
    assert.equal(phaseLoopGitHubConfigDirForShell(profile), '');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('implementation rejects credentials outside repository private state', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-profile-'));
  try {
    const profile = resolvePhaseLoopGitHubProfile({
      repoRoot: repo,
      role: 'implementation',
      credentials: {
        ...credentials,
        roles: { ...credentials.roles, implementation: { kind: 'repository-private', github_config_dir: '../../outside' } }
      }
    });
    assert.equal(profile.ok, false);
    assert.equal(profile.code, 'github_profile_outside_private_root');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('implementation can use a control-plane private profile while validating an isolated workspace', () => {
  const control = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-control-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-workspace-'));
  try {
    const configuredProfile = path.join(control, '.brownie/private/profiles/implementation');
    fs.mkdirSync(configuredProfile, { recursive: true });
    const profile = resolvePhaseLoopGitHubProfile({
      repoRoot: workspace,
      credentialsRoot: control,
      role: 'implementation',
      credentials
    });
    assert.equal(profile.ok, true);
    assert.equal(profile.github_config_dir, configuredProfile);
  } finally {
    fs.rmSync(control, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('accepts configured implementation identity and branch', () => {
  const errors = validatePhaseLoopActorPreflight({
    repository: 'example-org/example-repo', githubActor: 'implementation-bot', branch: 'automation/fix'
  }, { role: 'implementation', deployment });
  assert.deepEqual(errors, []);
});

test('rejects a configured review actor from implementation', () => {
  const errors = validatePhaseLoopActorPreflight({
    repository: 'example-org/example-repo', githubActor: 'reviewer-a', branch: 'automation/fix'
  }, { role: 'implementation', deployment });
  assert(errors.some((error) => error.includes('must use GitHub actor implementation-bot')));
  assert(errors.some((error) => error.includes('forbidden actor reviewer-a')));
});

test('rejects implementation from main or a branch outside configured prefixes', () => {
  const mainErrors = validatePhaseLoopActorPreflight({
    repository: 'example-org/example-repo', githubActor: 'implementation-bot', branch: 'main'
  }, { role: 'implementation', deployment });
  assert(mainErrors.some((error) => error.includes('non-main implementation branch')));

  const prefixErrors = validatePhaseLoopActorPreflight({
    repository: 'example-org/example-repo', githubActor: 'implementation-bot', branch: 'review/fix'
  }, { role: 'implementation', deployment });
  assert(prefixErrors.some((error) => error.includes('must start with one of')));
});

test('accepts configured review identity and rejects implementation identity', () => {
  const accepted = validatePhaseLoopActorPreflight({
    repository: 'example-org/example-repo', githubActor: 'reviewer-a', branch: 'review/fix'
  }, { role: 'review', deployment });
  assert.deepEqual(accepted, []);

  const rejected = validatePhaseLoopActorPreflight({
    repository: 'example-org/example-repo', githubActor: 'implementation-bot', branch: 'automation/fix'
  }, { role: 'review', deployment });
  assert(rejected.some((error) => error.includes('must use GitHub actor reviewer-a')));
  assert(rejected.some((error) => error.includes('forbidden actor implementation-bot')));
});
