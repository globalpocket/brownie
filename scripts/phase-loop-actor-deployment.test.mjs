import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadPhaseLoopActorDeployment, roleBranchPrefixes, validateActorDeployment } from './phase-loop-actor-deployment.mjs';

const deployment = {
  schema_version: 1,
  repository: 'another-org/another-repo',
  roles: {
    implementation: { github_login: 'ci-writer', branch_prefixes: ['delivery/'] },
    review: { github_login: 'release-review' },
    merge: { github_login: 'release-merge' }
  },
  constraints: { require_independent_review: true }
};

test('loads an alternate deployment only when its path is explicitly supplied', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-deployment-'));
  try {
    const file = path.join(repo, '.brownie/phase-loop-actor-deployment.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(deployment));
    const loaded = loadPhaseLoopActorDeployment({ repoRoot: repo, deploymentPath: file });
    assert.equal(loaded.ok, true, loaded.errors.join('\n'));
    assert.equal(loaded.deployment.roles.implementation.github_login, 'ci-writer');
    assert.deepEqual(roleBranchPrefixes(loaded.deployment, 'implementation'), ['delivery/']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('rejects implicit repository-relative deployment discovery', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-deployment-'));
  try {
    const file = path.join(repo, '.brownie/phase-loop-actor-deployment.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(deployment));
    const loaded = loadPhaseLoopActorDeployment({ repoRoot: repo, env: {} });
    assert.equal(loaded.ok, false);
    assert.match(loaded.errors.join('\n'), /must be supplied explicitly/u);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('rejects a collapsed implementation and review deployment', () => {
  const errors = validateActorDeployment({
    ...deployment,
    roles: { ...deployment.roles, review: { github_login: 'ci-writer' } }
  });
  assert(errors.some((error) => error.includes('must differ')));
});
