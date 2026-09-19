import assert from 'node:assert/strict';
import test from 'node:test';

import { validateBdkAgentSkills } from './guard-bdk-agent-skills.mjs';

test('current BDK Agent Skills architecture and schema are valid', () => {
  assert.deepEqual(validateBdkAgentSkills(), []);
});

test('rejects a present lockfile that allows scripts without approved review', () => {
  const errors = validateBdkAgentSkills({
    lockPath: 'scripts/fixtures/bdk-agent-skills-lock-unapproved-script.json'
  });
  assert(errors.some((error) => error.includes('cannot allow scripts without approved review')));
});

test('rejects architecture text missing policy precedence', () => {
  const errors = validateBdkAgentSkills({
    docPath: 'scripts/fixtures/bdk-agent-skills-adapter-missing-policy.md'
  });
  assert(errors.some((error) => error.includes('policy override precedence')));
});
