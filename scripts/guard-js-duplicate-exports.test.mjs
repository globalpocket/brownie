import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findDuplicateExportDeclarations,
  findDuplicateNodeTestDeclarations
} from './guard-js-duplicate-exports.mjs';

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

test('ignores exported-declaration lookalikes in template literals and comments', () => {
  const duplicates = findDuplicateExportDeclarations(`
const fixture = \`export function repeated() {} export function repeated() {}\`;
// export function commentOnly() {}
`);
  assert.deepEqual(duplicates, []);
});

test('accepts unique static node:test declarations', () => {
  const duplicates = findDuplicateNodeTestDeclarations(`
import test from 'node:test';

test('first behavior', () => {});
test.skip('deferred behavior', () => {});
`);
  assert.deepEqual(duplicates, []);
});

test('rejects duplicate static node:test declarations across modifiers', () => {
  const duplicates = findDuplicateNodeTestDeclarations(`
import test from 'node:test';

test('package integrity rejects tampering', () => {});
test.only('package integrity rejects tampering', () => {});
`);
  assert.deepEqual(duplicates, [{ name: 'package integrity rejects tampering', count: 2 }]);
});

test('ignores node:test-looking fixture content in template literals and comments', () => {
  const duplicates = findDuplicateNodeTestDeclarations(`
import test from 'node:test';

const fixture = \`test('fixture duplicate', () => {}); test('fixture duplicate', () => {});\`;
// test('comment duplicate', () => {}); test('comment duplicate', () => {});
test('real behavior', () => {});
`);
  assert.deepEqual(duplicates, []);
});

test('ignores duplicate calls when node:test is not imported', () => {
  const duplicates = findDuplicateNodeTestDeclarations(`
test('application callback', () => {});
test('application callback', () => {});
`);
  assert.deepEqual(duplicates, []);
});
