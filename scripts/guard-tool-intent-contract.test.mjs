import assert from 'node:assert/strict';
import test from 'node:test';

import { validateToolIntentSchema } from './guard-tool-intent-contract.mjs';
import schema from '../docs/architecture/tool-intent.schema.json' with { type: 'json' };

test('accepts the repository tool intent JSON Schema contract', () => {
  assert.deepEqual(validateToolIntentSchema(schema), []);
});

test('rejects a schema that does not cap workspace.write content', () => {
  const unsafe = structuredClone(schema);
  delete unsafe.$defs.workspace_write_input.properties.content.maxLength;
  const errors = validateToolIntentSchema(unsafe);
  assert(errors.some((error) => error.includes('content maxLength')));
});

test('rejects a schema that permits unknown workspace.write fields', () => {
  const unsafe = structuredClone(schema);
  unsafe.$defs.workspace_write_input.additionalProperties = true;
  const errors = validateToolIntentSchema(unsafe);
  assert(errors.some((error) => error.includes('reject unknown fields')));
});
