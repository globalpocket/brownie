#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTodoDecompositionText } from './guard-todo-decomposition.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = process.env.BROWNIE_REPAIR_TODO_REPO_ROOT
  ? path.resolve(process.env.BROWNIE_REPAIR_TODO_REPO_ROOT)
  : path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) {
      continue;
    }
    args.set(key.slice(2), argv[index + 1]);
    index += 1;
  }
  return args;
}

function readText(relativePath) {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), 'utf8');
}

function writeAtomic(relativePath, content) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const tmp = `${absolutePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, absolutePath);
}

function readJson(absoluteOrRelativePath) {
  const absolutePath = path.isAbsolute(absoluteOrRelativePath)
    ? absoluteOrRelativePath
    : path.resolve(repoRoot, absoluteOrRelativePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function packageScripts() {
  const pkg = JSON.parse(readText('package.json'));
  return new Set(Object.keys(pkg.scripts ?? {}));
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

function checkedTodoBlocks(text) {
  const starts = [];
  const pattern = /^(?:[-*]|\d+[.)])\s+\[[xX]\]\s+/gm;
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
  return firstLine.replace(/^(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+/, '').split(':')[0]?.trim() ?? '';
}

function firstLine(block) {
  return block.split('\n')[0]?.trim() ?? '';
}

function parseDependsOn(block) {
  for (const line of block.split('\n')) {
    const stripped = line.trim();
    if (!stripped.startsWith('Depends on:')) {
      continue;
    }
    const raw = stripped.slice('Depends on:'.length).trim().replace(/[.]$/u, '');
    if (!raw || raw === '<none>' || raw.toLowerCase() === 'none') {
      return [];
    }
    return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function patchOnlyScopes(block) {
  const first = firstLine(block);
  const start = first.indexOf('Patch only');
  if (start < 0) {
    return [];
  }
  const rest = first.slice(start + 'Patch only'.length);
  return [...rest.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function extractBacktickedPaths(text) {
  return [...text.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((value) => value.includes('/') || value.startsWith('.brownie/'));
}

function replaceBacktickedPath(text, from, to) {
  return text.split(`\`${from}\``).join(`\`${to}\``);
}

function replaceDependsOn(block, dependencies) {
  const replacement = dependencies.length > 0
    ? `Depends on: ${dependencies.join(', ')}.`
    : 'Depends on: <none>.';
  const lines = block.split('\n');
  let changed = false;
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim().startsWith('Depends on:')) {
      continue;
    }
    const indent = lines[index].slice(0, lines[index].length - lines[index].trimStart().length);
    if (lines[index].trim() !== replacement) {
      lines[index] = `${indent}${replacement}`;
      changed = true;
    }
    break;
  }
  return { block: lines.join('\n'), changed };
}

function existingIds(todoText) {
  return new Set([...uncheckedTodoBlocks(todoText), ...checkedTodoBlocks(todoText)].map(todoId).filter(Boolean));
}

function inferExistingPatchTarget(missingTarget) {
  if (existingFile(missingTarget)) {
    return missingTarget;
  }
  const parsed = path.parse(missingTarget);
  const candidates = [];
  if (parsed.ext) {
    for (const extension of ['.md', '.json', '.jsonc', '.mjs', '.js', '.rs']) {
      if (extension !== parsed.ext) {
        candidates.push(path.join(parsed.dir, `${parsed.name}${extension}`));
      }
    }
  }
  const existingCandidates = candidates.filter((candidate) => existingFile(candidate));
  if (existingCandidates.length === 1) {
    return existingCandidates[0];
  }
  return null;
}

function existingFile(relativePath) {
  return fs.existsSync(path.resolve(repoRoot, relativePath));
}

function commandExists(command) {
  if (command.startsWith('pnpm --workspace-root ')) {
    const script = command.slice('pnpm --workspace-root '.length).trim().split(/\s+/u)[0];
    return packageScripts().has(script);
  }
  const nodeScript = command.match(/^node\s+(?:--test\s+)?(scripts\/[^\s]+)/u);
  if (nodeScript) {
    return existingFile(nodeScript[1]);
  }
  return command.startsWith('cargo ');
}

function verificationForPath(relativePath) {
  if (relativePath === 'docs/architecture/runtime-release-contract.json') {
    return ['pnpm --workspace-root guard:release-contract'];
  }
  if (relativePath === 'docs/architecture/runtime-release-readiness-audit.json') {
    return ['pnpm --workspace-root guard:runtime-release-readiness'];
  }
  if (relativePath === 'docs/architecture/phase-value-manifest.json') {
    return ['pnpm --workspace-root guard:phase-value'];
  }
  if (relativePath === 'docs/architecture/final-product-ready-judgment.md') {
    return ['pnpm --workspace-root guard:phase-value'];
  }
  if (relativePath === 'scripts/guard-release-contract.test.mjs') {
    return ['pnpm --workspace-root guard:release-contract:test'];
  }
  if (relativePath === 'scripts/guard-release-evidence-semantic-consistency.mjs') {
    return ['pnpm --workspace-root guard:release-evidence-semantic-consistency:test', 'pnpm --workspace-root guard:release-evidence-semantic-consistency'];
  }
  if (relativePath === 'scripts/guard-release-evidence-semantic-consistency.test.mjs') {
    return ['pnpm --workspace-root guard:release-evidence-semantic-consistency:test'];
  }
  if (relativePath.endsWith('.rs')) {
    return ['cargo fmt --all -- --check', 'cargo check --package brownie-protocol'];
  }
  if (relativePath.endsWith('.json') || relativePath.endsWith('.jsonc')) {
    return [`node scripts/guard-json-parse.mjs ${relativePath}`].filter(commandExists);
  }
  if (relativePath.endsWith('.test.mjs')) {
    return [`node --test ${relativePath}`];
  }
  if (relativePath.endsWith('.mjs') || relativePath.endsWith('.js')) {
    return [`node ${relativePath}`];
  }
  return ['pnpm --workspace-root guard:todo-decomposition'];
}

function joinCommands(commands) {
  const unique = [...new Set(commands)].filter(commandExists);
  if (unique.length === 0) {
    return 'Verification: blocker: no existing bounded verification command can validate this leaf; replace with an executable verifier before implementation.';
  }
  if (unique.length === 1) {
    return `Verification: run \`${unique[0]}\`.`;
  }
  const quoted = unique.map((command) => `\`${command}\``);
  return `Verification: run ${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}.`;
}

function defaultLeavesForBroadTodo(sourceId, sourceBlock, decompositionId) {
  if (sourceId === 'E-19h-release-contract-trace-binding') {
    return [
      {
        id: 'E-19h-release-contract-trace-test',
        firstLine: '- [ ] E-19h-release-contract-trace-test: Patch only `scripts/guard-release-contract.test.mjs` to reject implemented release evidence sections whose trace fields remain pending:',
        route: 'implementation',
        source: sourceId,
        depends: '<none>',
        completion: 'Release contract tests fail when implementation commit, tested commit, workflow run id, or artifact SHA remain pending while the related evidence section claims implemented status.',
        forbidden: 'do not weaken existing release contract checks, do not fill placeholders as real evidence, and do not declare Runtime Product Ready.',
        verification: ['pnpm --workspace-root guard:release-contract:test']
      },
      {
        id: 'E-19h-release-contract-trace-fields',
        firstLine: '- [ ] E-19h-release-contract-trace-fields: Patch only `docs/architecture/runtime-release-contract.json` and `docs/architecture/runtime-release-readiness-audit.json` to keep trace binding evidence fail-closed until real values exist:',
        route: 'documentation',
        source: sourceId,
        depends: 'E-19h-release-contract-trace-test',
        completion: 'Release Contract and readiness audit expose explicit blockers when current tested commit, workflow run id, or artifact SHA bindings are missing or pending.',
        forbidden: 'do not replace missing values with invented placeholders, do not mark evidence implemented without generated evidence, and do not declare Runtime Release Ready.',
        verification: ['pnpm --workspace-root guard:release-contract', 'pnpm --workspace-root guard:runtime-release-readiness']
      }
    ];
  }

  const paths = extractBacktickedPaths(firstLine(sourceBlock))
    .filter((target) => !target.includes(' '))
    .filter((target) => !target.startsWith('http'));
  if (paths.length === 0) {
    return [{
      id: `${sourceId}-blocker`,
      firstLine: `- [ ] ${sourceId}-blocker: Blocker: deterministic TODO decomposition could not infer bounded target paths for ${sourceId}:`,
      route: 'release-ops',
      source: sourceId,
      depends: '<none>',
      completion: 'A human or owner-visible controller identifies concrete bounded target paths before implementation proceeds.',
      forbidden: 'do not patch workspace files for this blocker and do not declare Runtime Product Ready.',
      verification: []
    }];
  }

  const chunks = [];
  for (let index = 0; index < paths.length; index += 2) {
    chunks.push(paths.slice(index, index + 2));
  }
  return chunks.map((chunk, index) => {
    const suffix = String.fromCharCode('a'.charCodeAt(0) + index);
    const scopes = chunk.map((target) => `\`${target}\``).join(' and ');
    const route = chunk.every((target) => target.startsWith('docs/')) ? 'documentation' : 'implementation';
    return {
      id: `${sourceId}-leaf-${suffix}`,
      firstLine: `- [ ] ${sourceId}-leaf-${suffix}: Patch only ${scopes} to close one bounded slice of ${sourceId}:`,
      route,
      source: sourceId,
      depends: index === 0 ? '<none>' : `${sourceId}-leaf-${String.fromCharCode('a'.charCodeAt(0) + index - 1)}`,
      completion: `The bounded ${sourceId} slice for ${chunk.join(', ')} is implemented and verified without changing unrelated release readiness state.`,
      forbidden: 'do not edit unrelated files, do not invent release evidence values, and do not declare Runtime Product Ready.',
      verification: chunk.flatMap(verificationForPath)
    };
  });
}

function renderLeaf(leaf) {
  return [
    leaf.firstLine,
    `  Route: ${leaf.route}.`,
    `  Source TODO: ${leaf.source}.`,
    `  Depends on: ${leaf.depends}.`,
    `  Completion condition: ${leaf.completion}`,
    `  Forbidden changes: ${leaf.forbidden}`,
    `  ${joinCommands(leaf.verification)}`
  ].join('\n');
}

function replaceFirst(text, needle, replacement) {
  const index = text.indexOf(needle);
  if (index < 0) {
    return null;
  }
  return text.slice(0, index) + replacement + text.slice(index + needle.length);
}

function repairSelectedLeafTodoContract({ claim, todoText, breakdownText, todoPath, breakdownPath }) {
  const selected = claim.selected_todo;
  if (typeof selected !== 'string') {
    return { applied: false, eligible: false, reason: 'selected_todo_missing' };
  }
  const selectedId = todoId(selected);
  if (!selectedId || selected.includes('TODO-decompose-broad-todo-') || selected.includes('Route: todo-decomposition')) {
    return { applied: false, eligible: false, reason: 'selected_todo_is_not_repairable_leaf' };
  }
  const blocks = uncheckedTodoBlocks(todoText);
  const selectedBlock = blocks.find((block) => todoId(block) === selectedId);
  if (!selectedBlock) {
    return { applied: false, eligible: false, reason: 'selected_leaf_missing_from_todo', selectedId };
  }

  let normalizedBlock = selectedBlock;
  const notes = [];

  for (const target of patchOnlyScopes(selectedBlock)) {
    if (existingFile(target)) {
      continue;
    }
    const replacement = inferExistingPatchTarget(target);
    if (!replacement || replacement === target) {
      continue;
    }
    normalizedBlock = replaceBacktickedPath(normalizedBlock, target, replacement);
    breakdownText = replaceBacktickedPath(breakdownText, target, replacement);
    notes.push({
      normalization: 'missing_patch_only_target_replaced_with_existing_peer',
      from: target,
      to: replacement
    });
  }

  const ids = existingIds(todoText);
  const dependencies = parseDependsOn(normalizedBlock);
  const liveDependencies = dependencies.filter((dependency) => ids.has(dependency));
  const removedDependencies = dependencies.filter((dependency) => !ids.has(dependency));
  if (removedDependencies.length > 0) {
    const replaced = replaceDependsOn(normalizedBlock, liveDependencies);
    normalizedBlock = replaced.block;
    if (replaced.changed) {
      notes.push({
        normalization: 'removed_non_live_leaf_dependencies',
        removed: removedDependencies
      });
      for (const removed of removedDependencies) {
        const graphPattern = new RegExp(`(^-\\s+${selectedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*)${removed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*$)`, 'mu');
        breakdownText = breakdownText.replace(graphPattern, `$1<none>$2`);
      }
    }
  }

  if (notes.length === 0 || normalizedBlock === selectedBlock) {
    return { applied: false, eligible: false, reason: 'selected_leaf_no_deterministic_repair', selectedId };
  }

  let updatedTodo = replaceFirst(todoText, selectedBlock, normalizedBlock);
  if (updatedTodo === null) {
    return { applied: false, eligible: true, reason: 'selected_leaf_not_found_by_exact_slice', selectedId };
  }
  updatedTodo = updatedTodo.replace(/\n{3,}/gu, '\n\n').trimEnd() + '\n';

  const validationErrors = validateTodoDecompositionText(updatedTodo, {
    path: todoPath,
    repoRoot,
    packageScripts: packageScripts(),
    breakdownPath,
    breakdownText,
    productReady: false,
    releaseBlockersRemaining: true
  });
  if (validationErrors.length > 0) {
    return {
      applied: false,
      eligible: true,
      reason: 'repaired_leaf_todo_failed_guard',
      selectedId,
      validationErrors,
      normalizations: notes
    };
  }

  writeAtomic(todoPath, updatedTodo);
  writeAtomic(breakdownPath, breakdownText);
  return {
    applied: true,
    operation: 'deterministic_leaf_todo_contract_repair',
    selectedId,
    todoPath,
    breakdownPath,
    normalizations: notes
  };
}

function upsertBreakdownSection({ breakdownText, decompositionId, sourceId, leaves, runStamp }) {
  const sectionHeader = `## ${decompositionId}`;
  const graph = leaves.map((leaf) => `- ${leaf.id}: ${leaf.depends}`).join('\n');
  const ledger = leaves.map((leaf) => `- ${leaf.id}: ${joinCommands(leaf.verification).replace(/^Verification: /u, '')}`).join('\n');
  const rubric = leaves.map((leaf) => `- ${leaf.id}: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.`).join('\n');
  const section = [
    sectionHeader,
    '',
    `Parent TODO: ${sourceId}`,
    '',
    'Dependency graph:',
    graph,
    '',
    'Verification ledger:',
    ledger,
    '',
    'Quality rubric:',
    rubric,
    '',
    'History:',
    '',
    `- ${new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')}: Deterministically decomposed ${sourceId} during ${runStamp}; avoided LLM old_text patch anchors and resolved verification commands from existing package scripts.`
  ].join('\n');

  if (!breakdownText.includes(sectionHeader)) {
    return `${breakdownText.trimEnd()}\n\n${section}\n`;
  }
  const pattern = new RegExp(`(?ms)^## ${decompositionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n.*?(?=^## |\\Z)`);
  return breakdownText.replace(pattern, `${section}\n`);
}

export function repairTodoDecomposition({
  claimPath = '.brownie/private/phase-loop/todo-claims/current.json',
  todoPath = '.brownie/todo.md',
  breakdownPath = '.brownie/todo-breakdown.md',
  runStamp = new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
} = {}) {
  const claim = readJson(claimPath);
  const selected = claim.selected_todo;
  const todoText = readText(todoPath);
  const breakdownText = fs.existsSync(path.resolve(repoRoot, breakdownPath)) ? readText(breakdownPath) : '# TODO breakdown\n';
  const leafRepair = repairSelectedLeafTodoContract({ claim, todoText, breakdownText, todoPath, breakdownPath });
  if (leafRepair.applied || leafRepair.eligible) {
    return leafRepair;
  }
  if (typeof selected !== 'string' || !selected.includes('TODO-decompose-broad-todo-') || !selected.includes('Route: todo-decomposition')) {
    return { applied: false, eligible: false, reason: 'selected_todo_is_not_broad_decomposition' };
  }
  const decompositionId = todoId(selected);
  const sourceMatch = selected.match(/Decompose broad TODO `([^`]+)`/u);
  if (!sourceMatch) {
    return { applied: false, eligible: false, reason: 'missing_source_todo_id' };
  }
  const sourceId = sourceMatch[1];
  const blocks = uncheckedTodoBlocks(todoText);
  const selectedBlock = blocks.find((block) => todoId(block) === decompositionId);
  const sourceBlock = blocks.find((block) => todoId(block) === sourceId);
  if (!selectedBlock || !sourceBlock) {
    return { applied: false, eligible: false, reason: 'selected_or_source_block_missing', decompositionId, sourceId };
  }

  const leaves = defaultLeavesForBroadTodo(sourceId, sourceBlock, decompositionId);
  const leafText = `${leaves.map(renderLeaf).join('\n\n')}\n`;
  let updatedTodo = replaceFirst(todoText, selectedBlock, '');
  if (updatedTodo === null) {
    return { applied: false, eligible: true, reason: 'selected_block_not_found_by_exact_slice', decompositionId, sourceId };
  }
  updatedTodo = replaceFirst(updatedTodo, sourceBlock, leafText);
  if (updatedTodo === null) {
    return { applied: false, eligible: true, reason: 'source_block_not_found_by_exact_slice', decompositionId, sourceId };
  }
  updatedTodo = updatedTodo.replace(/\n{3,}/gu, '\n\n').trimEnd() + '\n';
  const updatedBreakdown = upsertBreakdownSection({ breakdownText, decompositionId, sourceId, leaves, runStamp });
  const validationErrors = validateTodoDecompositionText(updatedTodo, {
    path: todoPath,
    repoRoot,
    packageScripts: packageScripts(),
    breakdownPath,
    breakdownText: updatedBreakdown,
    productReady: false,
    releaseBlockersRemaining: true
  });
  if (validationErrors.length > 0) {
    return {
      applied: false,
      eligible: true,
      reason: 'repaired_todo_failed_guard',
      decompositionId,
      sourceId,
      validationErrors
    };
  }
  writeAtomic(todoPath, updatedTodo);
  writeAtomic(breakdownPath, updatedBreakdown);
  return {
    applied: true,
    operation: 'deterministic_todo_decomposition_repair',
    decompositionId,
    sourceId,
    leafIds: leaves.map((leaf) => leaf.id),
    todoPath,
    breakdownPath,
    runStamp
  };
}

if (process.argv[1] === __filename) {
  const args = parseArgs(process.argv);
  const result = repairTodoDecomposition({
    claimPath: args.get('claim') ?? '.brownie/private/phase-loop/todo-claims/current.json',
    todoPath: args.get('todo') ?? '.brownie/todo.md',
    breakdownPath: args.get('breakdown') ?? '.brownie/todo-breakdown.md',
    runStamp: args.get('run-stamp') ?? new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.applied ? 0 : result.eligible ? 1 : 2);
}
