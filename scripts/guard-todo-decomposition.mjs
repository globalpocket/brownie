#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultTodoPath = '.brownie/todo.md';
const defaultBreakdownPath = '.brownie/todo-breakdown.md';
const maxLeafBlockChars = 1800;
const maxLeafBlockLines = 12;
const allowedRoutes = new Set(['implementation', 'documentation', 'release-ops', 'todo-decomposition']);

function readText(repoRoot, relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function maybeReadText(repoRoot, relativePath) {
  try {
    return readText(repoRoot, relativePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function uncheckedTodoBlocks(text) {
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

function sourceTodoLines(block) {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Source TODO:'));
}

function verificationLines(block) {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Verification:'));
}

function completionLines(block) {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Completion condition:'));
}

function forbiddenLines(block) {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Forbidden changes:'));
}

function dependenciesLines(block) {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Depends on:'));
}

function parseDependsOn(block) {
  const line = dependenciesLines(block)[0] ?? '';
  const raw = line.slice('Depends on:'.length).trim().replace(/[.]$/, '');
  if (!raw || raw === '<none>') {
    return [];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function routeValue(block) {
  const line = block
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('Route:'));
  return line?.slice('Route:'.length).trim().replace(/[.]$/, '').toLowerCase() ?? '';
}

function backtickedValues(text) {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function packageScripts(repoRoot) {
  const pkg = JSON.parse(readText(repoRoot, 'package.json'));
  return new Set(Object.keys(pkg.scripts ?? {}));
}

function verificationCommandValues(block) {
  return verificationLines(block).flatMap(backtickedValues);
}

function isAllowedVerificationCommand(command) {
  const lower = command.toLowerCase();
  return (
    lower.startsWith('pnpm --workspace-root ') ||
    lower.startsWith('cargo fmt ') ||
    lower.startsWith('cargo check') ||
    lower.startsWith('cargo test') ||
    lower.startsWith('node scripts/') ||
    lower.startsWith('node --test scripts/')
  );
}

function hasAllowedVerification(block) {
  const lines = verificationLines(block);
  if (lines.length === 0) {
    return false;
  }
  return lines.every((line) => {
    const value = line.slice('Verification:'.length).toLowerCase();
    if (value.includes('inspect ') || value.includes('blocker') || value.includes('fail-closed')) {
      return true;
    }
    const commands = backtickedValues(line);
    return commands.length > 0 && commands.every(isAllowedVerificationCommand);
  });
}

function scopeLine(block) {
  const firstLine = block.split('\n')[0] ?? '';
  return firstLine;
}

function patchOnlyScopes(block) {
  const firstLine = scopeLine(block);
  const match = firstLine.match(/Patch only\s+(.+?)(?::|$)/);
  if (!match) {
    return [];
  }
  return backtickedValues(match[1]);
}

function createOnlyScopes(block) {
  const firstLine = scopeLine(block);
  const match = firstLine.match(/Create only\s+(.+?)(?::|$)/);
  if (!match) {
    return [];
  }
  return backtickedValues(match[1]);
}

function boundedScopes(block) {
  return [...patchOnlyScopes(block), ...createOnlyScopes(block)];
}

function parentFromSource(block) {
  const line = sourceTodoLines(block)[0] ?? '';
  const source = line.slice('Source TODO:'.length).trim();
  const id = source.split(':')[0]?.trim();
  return id || null;
}

function parentPrefix(parent) {
  const product = parent?.match(/^([A-Z]+-\d+[a-z]?)/)?.[1];
  return product ?? null;
}

function isDecompositionDerived(block) {
  return sourceTodoLines(block).length > 0;
}

function checkedTodoIds(text) {
  return new Set(
    [...text.matchAll(/^(?:[-*]|\d+[.)])\s+\[[xX]\]\s+([^:\n]+):/gm)]
      .map((match) => match[1].trim())
      .filter(Boolean)
  );
}

function uncheckedTodoIdSet(text) {
  return new Set(uncheckedTodoBlocks(text).map(todoId).filter(Boolean));
}

function dependencyGraph(blocks) {
  return new Map(blocks.map((block) => [todoId(block), parseDependsOn(block)]).filter(([id]) => Boolean(id)));
}

function hasDependencyCycle(graph) {
  const visiting = new Set();
  const visited = new Set();
  function visit(node) {
    if (visiting.has(node)) {
      return true;
    }
    if (visited.has(node)) {
      return false;
    }
    visiting.add(node);
    for (const dep of graph.get(node) ?? []) {
      if (graph.has(dep) && visit(dep)) {
        return true;
      }
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }
  return [...graph.keys()].some(visit);
}

function validateQuality(block, errors, options = {}) {
  const id = todoId(block);
  const owner = `${options.path ?? defaultTodoPath} ${id || '<missing-id>'}`;
  const route = routeValue(block);
  const completion = completionLines(block).join(' ').toLowerCase();
  const verification = verificationLines(block).join(' ').toLowerCase();
  const forbidden = forbiddenLines(block).join(' ').toLowerCase();
  const scopes = boundedScopes(block);
  if (route && !allowedRoutes.has(route)) {
    errors.push(`${owner}: Route must be one of ${[...allowedRoutes].join(', ')}.`);
  }
  if (/fix everything|every problem|make .*release ready immediately|全部|すべて/.test(completion)) {
    errors.push(`${owner}: Completion condition is too broad for a leaf TODO.`);
  }
  if (completion.length < 40) {
    errors.push(`${owner}: Completion condition is too short to prove leaf completion.`);
  }
  if (route === 'implementation' && verification.includes('inspect ') && verificationCommandValues(block).length === 0) {
    errors.push(`${owner}: implementation leaves need executable verification, not inspect-only verification.`);
  }
  if (route === 'release-ops' && verificationCommandValues(block).length > 0) {
    errors.push(`${owner}: release-ops leaves should use bounded inspect/blocker/fail-closed verification instead of local implementation commands.`);
  }
  if (scopes.length > 0 && forbidden.includes('unrelated files') === false && forbidden.includes('do not ') === false) {
    errors.push(`${owner}: Forbidden changes must explicitly constrain unrelated edits.`);
  }
}

function validateLeafBlock(block, errors, options = {}) {
  const id = todoId(block);
  const owner = `${options.path ?? defaultTodoPath} ${id || '<missing-id>'}`;
  const sourceLines = sourceTodoLines(block);
  const dependsLines = dependenciesLines(block);
  const scopes = boundedScopes(block);
  const patchScopes = patchOnlyScopes(block);
  const createScopes = createOnlyScopes(block);
  const route = routeValue(block);
  const lower = block.toLowerCase();
  if (!id) {
    errors.push(`${owner}: missing TODO id.`);
  }
  if (block.length > maxLeafBlockChars) {
    errors.push(`${owner}: leaf block is too large (${block.length} chars > ${maxLeafBlockChars}).`);
  }
  if (block.split('\n').length > maxLeafBlockLines) {
    errors.push(`${owner}: leaf block has too many lines; keep decomposition leaves small and executable.`);
  }
  if (id.includes('TODO-decompose-blocked-queue')) {
    errors.push(`${owner}: broad decomposition TODO must not remain as a leaf.`);
  }
  for (const required of ['Route:', 'Source TODO:', 'Depends on:', 'Completion condition:', 'Forbidden changes:', 'Verification:']) {
    if (!block.includes(required)) {
      errors.push(`${owner}: missing ${required}`);
    }
  }
  if (
    !lower.includes('patch only `') &&
    !lower.includes('create only `') &&
    !lower.includes('blocker') &&
    !lower.includes('fail-closed')
  ) {
    errors.push(`${owner}: must name a bounded Patch only/Create only scope or explicit blocker/fail-closed condition.`);
  }
  if (!hasAllowedVerification(block)) {
    errors.push(`${owner}: Verification must use bounded allowlisted commands or explicit inspect/blocker/fail-closed condition.`);
  }
  if (scopes.length > 2) {
    errors.push(`${owner}: Patch only/Create only scope must name at most two concrete backticked paths.`);
  }
  const parent = parentFromSource(block);
  const prefix = parentPrefix(parent);
  if (prefix && !id.startsWith(`${prefix}-`)) {
    errors.push(`${owner}: TODO id must preserve parent prefix ${prefix}-.`);
  }
  if (sourceLines.length !== 1) {
    errors.push(`${owner}: must include exactly one Source TODO line.`);
  }
  if (dependsLines.length !== 1) {
    errors.push(`${owner}: must include exactly one Depends on line; use Depends on: <none> for independent leaves.`);
  }
  for (const target of patchScopes) {
    if (options.repoRoot && !fs.existsSync(path.join(options.repoRoot, target))) {
      errors.push(`${owner}: Patch only target does not exist: ${target}. Use Create only for new files.`);
    }
  }
  for (const target of createScopes) {
    if (options.repoRoot && fs.existsSync(path.join(options.repoRoot, target))) {
      errors.push(`${owner}: Create only target already exists: ${target}. Use Patch only for existing files.`);
    }
  }
  for (const command of verificationCommandValues(block)) {
    if (command.startsWith('pnpm --workspace-root ') && options.packageScripts) {
      const script = command.slice('pnpm --workspace-root '.length).split(/\s+/)[0];
      if (!options.packageScripts.has(script)) {
        errors.push(`${owner}: Verification references missing package script: ${script}.`);
      }
    }
  }
  if (route === 'documentation' && scopes.some((target) => !target.startsWith('docs/') && target !== '.brownie/todo.md')) {
    errors.push(`${owner}: documentation leaves may only patch docs/ targets or the TODO queue.`);
  }
  if (route === 'implementation' && scopes.some((target) => target.startsWith('docs/'))) {
    errors.push(`${owner}: implementation leaves must not patch docs/ targets.`);
  }
  validateQuality(block, errors, options);
}

function validateDependencies(text, blocks, errors, options = {}) {
  const owner = options.path ?? defaultTodoPath;
  const uncheckedIds = uncheckedTodoIdSet(text);
  const checkedIds = checkedTodoIds(text);
  const graph = dependencyGraph(blocks);
  if (hasDependencyCycle(graph)) {
    errors.push(`${owner}: TODO dependencies must not contain cycles.`);
  }
  for (const block of blocks) {
    const id = todoId(block);
    for (const dep of parseDependsOn(block)) {
      if (dep === id) {
        errors.push(`${owner} ${id}: TODO must not depend on itself.`);
      }
      if (!uncheckedIds.has(dep) && !checkedIds.has(dep) && options.breakdownText && !options.breakdownText.includes(dep)) {
        errors.push(`${owner} ${id}: dependency ${dep} is not present in unchecked, checked, or breakdown-ledger state.`);
      }
    }
  }
}

function firstSchedulableTodoId(text) {
  const blocks = uncheckedTodoBlocks(text);
  const uncheckedIds = uncheckedTodoIdSet(text);
  const blockedIds = new Set();
  for (const block of blocks) {
    const id = todoId(block);
    const deps = parseDependsOn(block);
    if (deps.some((dep) => uncheckedIds.has(dep) || blockedIds.has(dep))) {
      blockedIds.add(id);
      continue;
    }
    return id;
  }
  return null;
}

function validateBreakdownLedger(text, leafIds, errors, options = {}) {
  const owner = options.breakdownPath ?? defaultBreakdownPath;
  if (leafIds.length === 0) {
    return;
  }
  if (text === null) {
    errors.push(`${owner}: missing TODO decomposition ledger for ${leafIds.length} derived leaf TODO(s).`);
    return;
  }
  for (const id of leafIds) {
    if (!text.includes(id)) {
      errors.push(`${owner}: missing derived leaf TODO id ${id}.`);
    }
  }
  if (!text.includes('Parent TODO:')) {
    errors.push(`${owner}: missing Parent TODO entry.`);
  }
  if (!text.includes('Dependency graph:')) {
    errors.push(`${owner}: missing Dependency graph section.`);
  }
  if (!text.includes('Verification ledger:')) {
    errors.push(`${owner}: missing Verification ledger section.`);
  }
  if (!text.includes('Quality rubric:')) {
    errors.push(`${owner}: missing Quality rubric section.`);
  }
}

function scoreLeafBlock(block) {
  const scopes = boundedScopes(block);
  const commands = verificationCommandValues(block);
  const deps = parseDependsOn(block);
  const completion = completionLines(block).join(' ');
  const forbidden = forbiddenLines(block).join(' ');
  const score = {
    todo_id: todoId(block),
    leaf_size_score: block.length <= 1200 && block.split('\n').length <= 9 ? 2 : block.length <= maxLeafBlockChars && block.split('\n').length <= maxLeafBlockLines ? 1 : 0,
    scope_score: scopes.length > 0 && scopes.length <= 2 ? 2 : 0,
    verification_score: commands.length > 0 ? 2 : verificationLines(block).length > 0 ? 1 : 0,
    dependency_score: dependenciesLines(block).length === 1 && (deps.length > 0 || dependenciesLines(block)[0].includes('<none>')) ? 2 : 0,
    completion_clarity_score: completion.length >= 60 && !/fix everything|every problem|make .*release ready immediately|全部|すべて/i.test(completion) ? 2 : completion.length >= 40 ? 1 : 0,
    forbidden_specificity_score: forbidden.toLowerCase().includes('do not ') || forbidden.toLowerCase().includes('unrelated files') ? 2 : forbidden ? 1 : 0
  };
  score.total = score.leaf_size_score + score.scope_score + score.verification_score + score.dependency_score + score.completion_clarity_score + score.forbidden_specificity_score;
  score.max = 12;
  return score;
}

export function scoreTodoDecompositionText(text) {
  const leaves = uncheckedTodoBlocks(text).filter(isDecompositionDerived).map(scoreLeafBlock);
  const total = leaves.reduce((sum, leaf) => sum + leaf.total, 0);
  const max = leaves.reduce((sum, leaf) => sum + leaf.max, 0);
  return {
    schema_version: 1,
    leaf_count: leaves.length,
    total,
    max,
    score_percent: max > 0 ? Math.round((total / max) * 100) : 100,
    leaves
  };
}

export function validateTodoDecompositionText(text, options = {}) {
  const errors = [];
  const leafIds = [];
  const derivedBlocks = [];
  for (const block of uncheckedTodoBlocks(text)) {
    if (isDecompositionDerived(block)) {
      derivedBlocks.push(block);
      validateLeafBlock(block, errors, options);
      const id = todoId(block);
      if (id) {
        leafIds.push(id);
      }
    }
  }
  validateDependencies(text, derivedBlocks, errors, options);
  if (options.breakdownText !== undefined) {
    validateBreakdownLedger(options.breakdownText, leafIds, errors, options);
  }
  return errors;
}

export function nextSchedulableTodoId(text) {
  return firstSchedulableTodoId(text);
}

export function validateTodoDecomposition(repoRoot = defaultRepoRoot, todoPath = defaultTodoPath) {
  return validateTodoDecompositionText(readText(repoRoot, todoPath), {
    path: todoPath,
    repoRoot,
    packageScripts: packageScripts(repoRoot),
    breakdownPath: defaultBreakdownPath,
    breakdownText: maybeReadText(repoRoot, defaultBreakdownPath)
  });
}

if (process.argv[1] === __filename) {
  const todoPath = process.argv[2] ?? defaultTodoPath;
  const scoreMode = process.argv.includes('--score');
  const actualTodoPath = todoPath === '--score' ? defaultTodoPath : todoPath;
  if (scoreMode) {
    console.log(JSON.stringify(scoreTodoDecompositionText(readText(defaultRepoRoot, actualTodoPath)), null, 2));
    process.exit(0);
  }
  const errors = validateTodoDecomposition(defaultRepoRoot, actualTodoPath);
  if (errors.length > 0) {
    console.error('TODO decomposition guard failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log(`TODO decomposition guard passed for ${actualTodoPath}.`);
}
