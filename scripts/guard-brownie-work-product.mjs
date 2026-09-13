#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultEvidencePath = '.brownie/release-evidence/brownie-work-product-review.json';

function backtickedValues(text) {
  return [...String(text ?? '').matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function firstLine(todo) {
  return String(todo ?? '').split('\n')[0] ?? '';
}

function todoId(todo) {
  const title = firstLine(todo).replace(/^(?:[-*]|\d+[.)])\s+\[\s\]\s+/, '');
  return title.split(':')[0]?.trim() ?? '';
}

function patchOnlyTargets(todo) {
  const match = firstLine(todo).match(/Patch only\s+(.+?)(?::|$)/);
  return match ? backtickedValues(match[1]) : [];
}

function createOnlyTargets(todo) {
  const match = firstLine(todo).match(/Create only\s+(.+?)(?::|$)/);
  return match ? backtickedValues(match[1]) : [];
}

function verificationCommands(todo) {
  return String(todo ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Verification:'))
    .flatMap(backtickedValues);
}

function forbiddenTargets(todo) {
  return String(todo ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Forbidden changes:'))
    .flatMap(backtickedValues);
}

export function validateBrownieWorkProduct(evidence) {
  const errors = [];
  const todo = evidence?.selected_todo ?? '';
  const id = todoId(todo);
  const changedFiles = Array.isArray(evidence?.changed_files) ? evidence.changed_files : [];
  const executed = new Set(Array.isArray(evidence?.verification_commands_executed) ? evidence.verification_commands_executed : []);
  const allowedTargets = new Set([...patchOnlyTargets(todo), ...createOnlyTargets(todo)]);
  const requiredVerification = verificationCommands(todo);
  const forbidden = new Set(forbiddenTargets(todo));
  const actor = evidence?.actor;

  if (!id) {
    errors.push('selected_todo must include a concrete TODO id.');
  }
  if (actor && actor !== 'brownie-agent') {
    errors.push('Brownie-generated work product evidence must be produced by actor brownie-agent.');
  }
  if (allowedTargets.size > 0) {
    for (const file of changedFiles) {
      if (!allowedTargets.has(file)) {
        errors.push(`${id}: changed file is outside Patch only/Create only scope: ${file}.`);
      }
    }
  }
  for (const file of changedFiles) {
    if (forbidden.has(file)) {
      errors.push(`${id}: changed file violates Forbidden changes: ${file}.`);
    }
  }
  for (const command of requiredVerification) {
    if (!executed.has(command)) {
      errors.push(`${id}: required verification command was not executed: ${command}.`);
    }
  }
  if (evidence?.runtime_release_ready_changed === true || evidence?.release_ready_changed === true) {
    errors.push(`${id}: Brownie work product must not flip release-ready state as an implementation side effect.`);
  }
  if (evidence?.todo_removed === true && evidence?.completion_condition_satisfied !== true) {
    errors.push(`${id}: TODO removal requires completion_condition_satisfied=true.`);
  }
  return errors;
}

export function runBrownieWorkProductGuard(repoRoot = defaultRepoRoot, evidencePath = defaultEvidencePath) {
  const absolute = path.join(repoRoot, evidencePath);
  if (!fs.existsSync(absolute)) {
    return { status: 'skipped', reason: 'no work product evidence present', errors: [] };
  }
  const evidence = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  const errors = validateBrownieWorkProduct(evidence);
  return { status: errors.length === 0 ? 'passed' : 'failed', evidencePath, errors };
}

if (process.argv[1] === __filename) {
  const evidencePath = process.argv[2] ?? defaultEvidencePath;
  const result = runBrownieWorkProductGuard(defaultRepoRoot, evidencePath);
  if (result.errors.length > 0) {
    console.error('Brownie work product guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}
