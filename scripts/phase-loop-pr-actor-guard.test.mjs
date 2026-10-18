import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readAuthenticatedActor,
  validateImplementationPrActor
} from './phase-loop-pr-actor-guard.mjs';

test('accepts brownie-agent as the implementation PR actor', () => {
  assert.deepEqual(validateImplementationPrActor('brownie-agent'), []);
});

test('rejects globalpocket before implementation PR creation', () => {
  const errors = validateImplementationPrActor('globalpocket');
  assert.deepEqual(errors, ['implementation PR creation requires GitHub actor brownie-agent; got globalpocket.']);
});

test('fails closed when GitHub actor lookup fails', () => {
  const result = readAuthenticatedActor({
    run: () => ({ status: 1, stdout: '', stderr: 'not authenticated' })
  });
  assert.equal(result.actor, '');
  assert.equal(result.error, 'not authenticated');
});
