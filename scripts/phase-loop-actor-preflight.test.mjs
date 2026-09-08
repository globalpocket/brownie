import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validatePhaseLoopActorPreflight
} from './phase-loop-actor-preflight.mjs';

const policy = {
  repository: 'globalpocket/brownie',
  implementation_actor: 'brownie-agent',
  review_actor: 'globalpocket',
  merge_actor: 'globalpocket',
  implementation_branch_prefixes: ['brownie-agent/', 'phase-loop/'],
  review_branch_prefixes: ['codex/']
};

test('accepts brownie-agent implementation actor on implementation branch', () => {
  const errors = validatePhaseLoopActorPreflight({
    repository: 'globalpocket/brownie',
    githubActor: 'brownie-agent',
    branch: 'brownie-agent/fix-release-evidence'
  }, { role: 'implementation', policy });
  assert.deepEqual(errors, []);
});

test('rejects globalpocket implementation actor', () => {
  const errors = validatePhaseLoopActorPreflight({
    repository: 'globalpocket/brownie',
    githubActor: 'globalpocket',
    branch: 'brownie-agent/fix-release-evidence'
  }, { role: 'implementation', policy });
  assert(errors.some((error) => error.includes('must use GitHub actor brownie-agent')));
  assert(errors.some((error) => error.includes('forbidden actor globalpocket')));
});

test('rejects implementation from main or codex review branch', () => {
  const mainErrors = validatePhaseLoopActorPreflight({
    repository: 'globalpocket/brownie',
    githubActor: 'brownie-agent',
    branch: 'main'
  }, { role: 'implementation', policy });
  assert(mainErrors.some((error) => error.includes('non-main implementation branch')));

  const codexErrors = validatePhaseLoopActorPreflight({
    repository: 'globalpocket/brownie',
    githubActor: 'brownie-agent',
    branch: 'codex/review-only'
  }, { role: 'implementation', policy });
  assert(codexErrors.some((error) => error.includes('must start with one of')));
});

test('accepts globalpocket review actor and rejects brownie-agent review actor', () => {
  const accepted = validatePhaseLoopActorPreflight({
    repository: 'globalpocket/brownie',
    githubActor: 'globalpocket',
    branch: 'codex/review'
  }, { role: 'review', policy });
  assert.deepEqual(accepted, []);

  const rejected = validatePhaseLoopActorPreflight({
    repository: 'globalpocket/brownie',
    githubActor: 'brownie-agent',
    branch: 'brownie-agent/fix'
  }, { role: 'review', policy });
  assert(rejected.some((error) => error.includes('must use GitHub actor globalpocket')));
  assert(rejected.some((error) => error.includes('forbidden actor brownie-agent')));
});

test('rejects unknown repository and missing GitHub actor', () => {
  const errors = validatePhaseLoopActorPreflight({
    repository: 'someone/else',
    githubActor: null,
    branch: 'brownie-agent/fix'
  }, { role: 'implementation', policy });
  assert(errors.some((error) => error.includes('remote origin must resolve')));
  assert(errors.some((error) => error.includes('authenticated GitHub actor must be available')));
});
