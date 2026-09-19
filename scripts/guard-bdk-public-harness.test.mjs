import assert from 'node:assert/strict';
import test from 'node:test';

import { validateBdkPublicHarness } from './guard-bdk-public-harness.mjs';

test('current public harness adapter contract is valid', () => {
  assert.deepEqual(validateBdkPublicHarness(), []);
});

test('rejects missing Patch only targets in TODO leaves', () => {
  const errors = validateBdkPublicHarness({
    todoPath: 'scripts/fixtures/bdk-public-harness-bad-todo.md',
    breakdownPath: 'scripts/fixtures/bdk-public-harness-breakdown.md'
  });
  assert(errors.some((error) => error.includes('Patch only target does not exist')));
});

test('rejects missing breakdown entries for derived TODO leaves', () => {
  const errors = validateBdkPublicHarness({
    todoPath: 'scripts/fixtures/bdk-public-harness-missing-breakdown-todo.md',
    breakdownPath: 'scripts/fixtures/bdk-public-harness-breakdown.md'
  });
  assert(errors.some((error) => error.includes('missing derived leaf TODO id')));
});

test('rejects malformed public harness trajectory JSONL', () => {
  const errors = validateBdkPublicHarness({
    trajectoryPath: 'scripts/fixtures/bdk-public-harness-bad-trajectory.jsonl'
  });
  assert(errors.some((error) => error.includes('claim_id is required')));
});
