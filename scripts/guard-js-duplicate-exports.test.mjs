import assert from 'node:assert/strict';
import test from 'node:test';
import { findDuplicateExportDeclarations } from './guard-js-duplicate-exports.mjs';

test('accepts unique exported declarations', () => {
  const duplicates = findDuplicateExportDeclarations(`
export function alpha() {}
export const beta = 1;
export class Gamma {}
`);
  assert.deepEqual(duplicates, []);
});

test('rejects duplicate exported declarations', () => {
  const duplicates = findDuplicateExportDeclarations(`
export function validateTraceBindingPayload(payload) {
  return payload;
}

export function validateTraceBindingPayload(payload) {
  return payload;
}
`);
  assert.deepEqual(duplicates, [{ name: 'validateTraceBindingPayload', count: 2 }]);
});
