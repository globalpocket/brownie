#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const defaultDocPath = 'docs/architecture/bdk-public-harness-adapter.md';
const defaultSchemaPath = 'docs/architecture/bdk-trajectory.schema.json';
const defaultTodoPath = '.brownie/todo.md';
const defaultBreakdownPath = '.brownie/todo-breakdown.md';
const defaultTrajectoryFixturePath = 'scripts/fixtures/bdk-public-harness-trajectory.jsonl';

const requiredEventTypes = [
  'todo.claimed',
  'workflow.routed',
  'skill.selected',
  'tool.read',
  'tool.write_proposed',
  'tool.write_applied',
  'verification.run',
  'progress.classified',
  'todo.completed',
  'todo.replanned',
  'todo.blocked'
];

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function exists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function requireValue(condition, errors, message) {
  if (!condition) {
    errors.push(message);
  }
}

function uncheckedTodoBlocks(text) {
  const starts = [];
  const pattern = /^(?:[-*]|\d+[.)])\s+\[\s\]\s+/gm;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    starts.push(match.index);
  }
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : text.length;
    return text.slice(start, end).trimEnd();
  });
}

function todoId(block) {
  const firstLine = block.split('\n')[0]?.trim() ?? '';
  const title = firstLine.replace(/^(?:[-*]|\d+[.)])\s+\[\s\]\s+/, '');
  return title.split(':')[0]?.trim() ?? '';
}

function sourceTodo(block) {
  const line = block
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('Source TODO:'));
  return line?.slice('Source TODO:'.length).trim().replace(/[.]$/, '') ?? '';
}

function firstLineScope(block, keyword) {
  const firstLine = block.split('\n')[0] ?? '';
  const match = firstLine.match(new RegExp(`${keyword} \\\`([^\\\`]+)\\\``));
  return match?.[1] ?? '';
}

function validateDoc({ docPath = defaultDocPath } = {}) {
  const errors = [];
  let text = '';
  try {
    text = readText(docPath);
  } catch {
    return [`${docPath} must exist.`];
  }
  for (const phrase of [
    'OpenHands',
    'SWE-agent',
    'LangGraph',
    'Trajectory contract',
    'Patch/Create precheck',
    'Eval fixtures',
    'todo.claimed',
    'tool.write_proposed',
    'progress.classified',
    'Harness feedback'
  ]) {
    requireValue(text.includes(phrase), errors, `${docPath} must mention ${phrase}.`);
  }
  return errors;
}

function validateSchema({ schemaPath = defaultSchemaPath } = {}) {
  const errors = [];
  let schema;
  try {
    schema = readJson(schemaPath);
  } catch {
    return [`${schemaPath} must be valid JSON.`];
  }
  requireValue(schema.type === 'object', errors, `${schemaPath} root must be object.`);
  requireValue(schema.additionalProperties === false, errors, `${schemaPath} root must be closed.`);
  requireValue(schema.properties?.schema_version?.const === 1, errors, `${schemaPath} schema_version const must be 1.`);
  const eventEnum = schema.properties?.events?.items?.properties?.type?.enum ?? [];
  for (const type of requiredEventTypes) {
    requireValue(eventEnum.includes(type), errors, `${schemaPath} must allow event type ${type}.`);
  }
  requireValue(
    schema.properties?.events?.items?.additionalProperties === false,
    errors,
    `${schemaPath} trajectory events must be closed objects.`
  );
  return errors;
}

function validateTrajectoryRecord(record, lineLabel) {
  const errors = [];
  requireValue(record && typeof record === 'object' && !Array.isArray(record), errors, `${lineLabel} must be an object.`);
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return errors;
  }
  requireValue(record.schema_version === 1, errors, `${lineLabel} schema_version must be 1.`);
  requireValue(typeof record.run_id === 'string' && record.run_id.length > 0, errors, `${lineLabel} run_id is required.`);
  requireValue(typeof record.claim_id === 'string' && record.claim_id.length > 0, errors, `${lineLabel} claim_id is required.`);
  requireValue(Array.isArray(record.events) && record.events.length > 0, errors, `${lineLabel} events must be non-empty.`);
  const extraRootKeys = Object.keys(record).filter((key) => !['schema_version', 'run_id', 'claim_id', 'events'].includes(key));
  requireValue(extraRootKeys.length === 0, errors, `${lineLabel} must not contain extra root keys: ${extraRootKeys.join(', ')}.`);
  for (const [index, event] of (record.events ?? []).entries()) {
    const eventLabel = `${lineLabel} events[${index}]`;
    requireValue(event && typeof event === 'object' && !Array.isArray(event), errors, `${eventLabel} must be an object.`);
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      continue;
    }
    requireValue(requiredEventTypes.includes(event.type), errors, `${eventLabel} has unsupported type ${event.type}.`);
    requireValue(typeof event.at === 'string' && event.at.length > 0, errors, `${eventLabel} at is required.`);
    requireValue(typeof event.todo_id === 'string' && event.todo_id.length > 0, errors, `${eventLabel} todo_id is required.`);
    requireValue(typeof event.claim_id === 'string' && event.claim_id.length > 0, errors, `${eventLabel} claim_id is required.`);
    requireValue(event.claim_id === record.claim_id, errors, `${eventLabel} claim_id must match root claim_id.`);
    requireValue(event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload), errors, `${eventLabel} payload must be an object.`);
    const extraEventKeys = Object.keys(event).filter((key) => !['type', 'at', 'todo_id', 'claim_id', 'payload'].includes(key));
    requireValue(extraEventKeys.length === 0, errors, `${eventLabel} must not contain extra keys: ${extraEventKeys.join(', ')}.`);
  }
  return errors;
}

function validateTrajectoryJsonl({ trajectoryPath = defaultTrajectoryFixturePath } = {}) {
  const errors = [];
  let text = '';
  try {
    text = readText(trajectoryPath);
  } catch {
    return [`${trajectoryPath} must exist.`];
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  requireValue(lines.length > 0, errors, `${trajectoryPath} must contain at least one JSONL record.`);
  for (const [index, line] of lines.entries()) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      errors.push(`${trajectoryPath}:${index + 1} must be valid JSON.`);
      continue;
    }
    errors.push(...validateTrajectoryRecord(record, `${trajectoryPath}:${index + 1}`));
  }
  return errors;
}

function validateTodoTargetPrecheck({
  todoPath = defaultTodoPath,
  breakdownPath = defaultBreakdownPath
} = {}) {
  const errors = [];
  let todoText = '';
  let breakdownText = '';
  try {
    todoText = readText(todoPath);
    breakdownText = readText(breakdownPath);
  } catch {
    return errors;
  }
  for (const block of uncheckedTodoBlocks(todoText)) {
    const id = todoId(block);
    const patchTarget = firstLineScope(block, 'Patch only');
    const createTarget = firstLineScope(block, 'Create only');
    if (patchTarget && !exists(patchTarget)) {
      errors.push(`${todoPath} ${id}: Patch only target does not exist: ${patchTarget}. Use Create only for new files.`);
    }
    if (createTarget && exists(createTarget)) {
      errors.push(`${todoPath} ${id}: Create only target already exists: ${createTarget}. Use Patch only for existing files.`);
    }
    const source = sourceTodo(block);
    if (source && id && !breakdownText.includes(`- ${id}:`)) {
      errors.push(`${breakdownPath}: missing derived leaf TODO id ${id}.`);
    }
  }
  return errors;
}

export function validateBdkPublicHarness(options = {}) {
  const errors = [
    ...validateDoc(options),
    ...validateSchema(options),
    ...validateTrajectoryJsonl(options),
    ...validateTodoTargetPrecheck(options)
  ];
  requireValue(exists('scripts/bdk-public-harness-evaluate.mjs'), errors, 'scripts/bdk-public-harness-evaluate.mjs must exist.');
  requireValue(exists('scripts/bdk-public-harness-evaluate.test.mjs'), errors, 'scripts/bdk-public-harness-evaluate.test.mjs must exist.');
  const liveTrajectoryPath = process.env.BDK_TRAJECTORY_FILE;
  if (liveTrajectoryPath) {
    errors.push(...validateTrajectoryJsonl({ ...options, trajectoryPath: liveTrajectoryPath }));
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = validateBdkPublicHarness();
  if (errors.length > 0) {
    console.error('BDK public harness guard failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log('BDK public harness guard passed.');
}
