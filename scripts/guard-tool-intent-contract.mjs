#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultSchemaPath = 'docs/architecture/tool-intent.schema.json';

function readJson(repoRoot, relativePath, errors) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
  } catch (error) {
    errors.push(`${relativePath} must be readable JSON: ${error.message}`);
    return {};
  }
}

function requireValue(condition, errors, message) {
  if (!condition) {
    errors.push(message);
  }
}

function hasRef(value, ref) {
  if (value === ref) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasRef(item, ref));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => hasRef(item, ref));
  }
  return false;
}

export function validateToolIntentSchema(schema) {
  const errors = [];
  requireValue(schema.$schema === 'https://json-schema.org/draft/2020-12/schema', errors, 'tool intent schema must use JSON Schema draft 2020-12.');
  requireValue(schema.type === 'object', errors, 'tool intent schema root must be an object.');
  requireValue(schema.additionalProperties === false, errors, 'tool intent schema root must reject additional properties.');
  requireValue(Array.isArray(schema.required) && schema.required.includes('tool_requests'), errors, 'tool intent schema must require tool_requests.');
  const requests = schema.properties?.tool_requests;
  requireValue(requests?.type === 'array', errors, 'tool_requests must be an array.');
  requireValue(requests?.minItems === 1, errors, 'tool_requests must require at least one request.');
  requireValue(requests?.maxItems === 8, errors, 'tool_requests maxItems must match Runtime parser limit 8.');
  const item = requests?.items;
  requireValue(item?.additionalProperties === false, errors, 'tool request items must reject unknown fields.');
  requireValue(item?.properties?.reason?.maxLength === 1000, errors, 'tool request reason maxLength must match Runtime parser limit 1000.');
  requireValue(hasRef(item, '#/$defs/workspace_write_input'), errors, 'tool intent schema must include workspace.write input contract.');
  const writeInput = schema.$defs?.workspace_write_input;
  requireValue(writeInput?.additionalProperties === false, errors, 'workspace.write input schema must reject unknown fields.');
  requireValue(writeInput?.properties?.hunks?.maxItems === 5, errors, 'workspace.write hunks maxItems must match Runtime parser limit 5.');
  requireValue(writeInput?.properties?.content?.maxLength === 20000, errors, 'workspace.write content maxLength must match Runtime parser limit 20000.');
  requireValue(hasRef(writeInput, '#/$defs/relative_path'), errors, 'workspace.write input must use bounded relative path schema.');
  const relativePath = schema.$defs?.relative_path;
  requireValue(relativePath?.not, errors, 'relative path schema must reject unsafe paths.');
  return errors;
}

export function runToolIntentContractGuard(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const schemaPath = options.schemaPath ?? defaultSchemaPath;
  const errors = [];
  const schema = options.schema ?? readJson(repoRoot, schemaPath, errors);
  return {
    errors: [...errors, ...validateToolIntentSchema(schema)],
    schemaPath
  };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const result = runToolIntentContractGuard();
  if (result.errors.length > 0) {
    console.error('Tool intent contract guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log(`Tool intent contract guard passed for ${result.schemaPath}.`);
}
