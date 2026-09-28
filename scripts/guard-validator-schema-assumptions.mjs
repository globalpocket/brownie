#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');

function readJson(repoRoot, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function readText(repoRoot, relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function inferredTopLevelDocFields(scriptText) {
  const fields = new Set();
  for (const match of scriptText.matchAll(/\bdoc\.([A-Za-z_$][\w$]*)/g)) {
    fields.add(match[1]);
  }
  for (const match of scriptText.matchAll(/\bdoc\[['"]([^'"]+)['"]\]/g)) {
    fields.add(match[1]);
  }
  return [...fields].sort();
}

export function validateValidatorSchemaAssumptions({
  repoRoot = defaultRepoRoot,
  validatorPath = 'scripts/validate-audit-schema.mjs',
  targetPath = 'docs/architecture/runtime-release-readiness-audit.json'
} = {}) {
  const errors = [];
  const target = readJson(repoRoot, targetPath);
  const scriptText = readText(repoRoot, validatorPath);
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    errors.push(`${targetPath} must be a top-level JSON object.`);
    return errors;
  }
  const targetKeys = new Set(Object.keys(target));
  const referencedFields = inferredTopLevelDocFields(scriptText);
  for (const field of referencedFields) {
    if (!targetKeys.has(field)) {
      errors.push(
        `${validatorPath} appears to require top-level field ${JSON.stringify(field)}, but ${targetPath} does not contain it. Read the target JSON shape and validate actual fields instead of an invented schema.`
      );
    }
  }
  return errors;
}

if (process.argv[1] === __filename) {
  const errors = validateValidatorSchemaAssumptions({
    validatorPath: process.argv[2] ?? 'scripts/validate-audit-schema.mjs',
    targetPath: process.argv[3] ?? 'docs/architecture/runtime-release-readiness-audit.json'
  });
  if (errors.length > 0) {
    console.error('Validator schema assumption guard failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log('Validator schema assumption guard passed.');
}
