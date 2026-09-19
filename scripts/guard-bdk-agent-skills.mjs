#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const defaultDocPath = 'docs/architecture/bdk-agent-skills-adapter.md';
const defaultSchemaPath = 'docs/architecture/bdk-agent-skills-lock.schema.json';
const defaultLockPath = '.brownie/skills.lock.json';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function requireValue(condition, errors, message) {
  if (!condition) {
    errors.push(message);
  }
}

function validateArchitectureDoc({ docPath = defaultDocPath } = {}) {
  const errors = [];
  let text = '';
  try {
    text = readText(docPath);
  } catch {
    return [`${docPath} must exist.`];
  }
  const requiredPhrases = [
    'SKILL.md',
    'Skill discovery',
    'Lockfile',
    'Permission manifest',
    'Router inputs',
    'Execution sandbox boundaries',
    'Evidence and trajectory outputs',
    'Brownie policy',
    'Runtime permissions',
    'script execution'
  ];
  for (const phrase of requiredPhrases) {
    requireValue(text.includes(phrase), errors, `${docPath} must mention ${phrase}.`);
  }
  requireValue(
    text.includes('brownie_policy_overrides_skill'),
    errors,
    `${docPath} must define Brownie policy override precedence.`
  );
  return errors;
}

function validateSchemaShape({ schemaPath = defaultSchemaPath } = {}) {
  const errors = [];
  let schema;
  try {
    schema = readJson(schemaPath);
  } catch {
    return [`${schemaPath} must be valid JSON.`];
  }
  requireValue(schema.type === 'object', errors, `${schemaPath} root type must be object.`);
  requireValue(schema.additionalProperties === false, errors, `${schemaPath} must be closed at root.`);
  requireValue(schema.properties?.schema_version?.const === 1, errors, `${schemaPath} schema_version const must be 1.`);
  const item = schema.properties?.skills?.items;
  requireValue(item?.additionalProperties === false, errors, `${schemaPath} skill entries must be closed.`);
  for (const field of ['id', 'source', 'content_hash', 'permissions', 'review', 'policy']) {
    requireValue(item?.required?.includes(field), errors, `${schemaPath} skill entries must require ${field}.`);
  }
  requireValue(
    item?.properties?.source?.properties?.type?.enum?.includes('git'),
    errors,
    `${schemaPath} source.type must allow git.`
  );
  requireValue(
    item?.properties?.permissions?.properties?.script_execution?.enum?.includes('forbidden'),
    errors,
    `${schemaPath} script_execution must support forbidden.`
  );
  requireValue(
    item?.properties?.policy?.properties?.brownie_policy_overrides_skill?.const === true,
    errors,
    `${schemaPath} must require brownie_policy_overrides_skill=true.`
  );
  return errors;
}

function validateLockEntry(entry, index) {
  const errors = [];
  const owner = `${defaultLockPath} skills[${index}]`;
  requireValue(typeof entry.id === 'string' && /^[a-z0-9][a-z0-9._:-]{1,127}$/.test(entry.id), errors, `${owner}.id must be stable.`);
  requireValue(['local', 'git', 'codex', 'builtin'].includes(entry.source?.type), errors, `${owner}.source.type is invalid.`);
  requireValue(typeof entry.source?.uri === 'string' && entry.source.uri.length > 0, errors, `${owner}.source.uri is required.`);
  requireValue(typeof entry.source?.revision === 'string' && entry.source.revision.length > 0, errors, `${owner}.source.revision is required.`);
  requireValue(typeof entry.content_hash === 'string' && /^sha256:[0-9a-f]{64}$/.test(entry.content_hash), errors, `${owner}.content_hash must be sha256.`);
  requireValue(Array.isArray(entry.permissions?.allowed_tools), errors, `${owner}.permissions.allowed_tools must be an array.`);
  requireValue(['forbidden', 'review_required', 'allowed'].includes(entry.permissions?.script_execution), errors, `${owner}.permissions.script_execution is invalid.`);
  requireValue(['approved', 'pending', 'rejected'].includes(entry.review?.status), errors, `${owner}.review.status is invalid.`);
  requireValue(entry.policy?.brownie_policy_overrides_skill === true, errors, `${owner}.policy.brownie_policy_overrides_skill must be true.`);
  if (entry.permissions?.script_execution === 'allowed') {
    requireValue(entry.review?.status === 'approved', errors, `${owner} cannot allow scripts without approved review.`);
  }
  return errors;
}

function validateOptionalLockfile({ lockPath = defaultLockPath } = {}) {
  const absolute = path.join(repoRoot, lockPath);
  if (!fs.existsSync(absolute)) {
    return [];
  }
  const errors = [];
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch {
    return [`${lockPath} must be valid JSON when present.`];
  }
  requireValue(lock.schema_version === 1, errors, `${lockPath} schema_version must be 1.`);
  requireValue(Array.isArray(lock.skills), errors, `${lockPath} skills must be an array.`);
  if (Array.isArray(lock.skills)) {
    const ids = new Set();
    lock.skills.forEach((entry, index) => {
      errors.push(...validateLockEntry(entry, index));
      if (ids.has(entry.id)) {
        errors.push(`${lockPath} duplicate skill id: ${entry.id}.`);
      }
      ids.add(entry.id);
    });
  }
  return errors;
}

export function validateBdkAgentSkills(options = {}) {
  return [
    ...validateArchitectureDoc(options),
    ...validateSchemaShape(options),
    ...validateOptionalLockfile(options)
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = validateBdkAgentSkills();
  if (errors.length > 0) {
    console.error('BDK Agent Skills guard failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log('BDK Agent Skills guard passed.');
}
