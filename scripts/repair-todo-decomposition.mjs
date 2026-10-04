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

function writeTodoReplanRecord({ parentTodoId, replacementSourceTodoId, generatedChildIds, reason, runStamp }) {
  const safeName = `${parentTodoId}-${runStamp}`.replace(/[^A-Za-z0-9_.-]+/gu, '-');
  const relativeDir = '.brownie/private/phase-loop/todo-replans';
  const absoluteDir = path.resolve(repoRoot, relativeDir);
  fs.mkdirSync(absoluteDir, { recursive: true, mode: 0o700 });
  const record = {
    schema_version: 1,
    record_type: 'todo_replan',
    operation: 'split_parent_into_children',
    parent_status: 'superseded_by_children',
    parent_todo_id: parentTodoId,
    replacement_source_todo_id: replacementSourceTodoId,
    generated_child_ids: generatedChildIds,
    replan_record_reason: reason,
    changed_files: ['.brownie/todo.md', '.brownie/todo-breakdown.md'],
    workspace_changed_files: ['.brownie/todo.md', '.brownie/todo-breakdown.md'],
    written_at: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    run_stamp: runStamp
  };
  writeAtomic(path.join(relativeDir, `${safeName}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return path.join(relativeDir, `${safeName}.json`);
}

function readTodoReplanRecords() {
  const absoluteDir = path.resolve(repoRoot, '.brownie/private/phase-loop/todo-replans');
  let entries = [];
  try {
    entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    try {
      records.push(JSON.parse(fs.readFileSync(path.join(absoluteDir, entry.name), 'utf8')));
    } catch {
      // Corrupt historical replan records are ignored; they cannot authorize queue mutation.
    }
  }
  return records;
}

function writeTransitiveReplanRecords({ removedParentIds, replacementSourceTodoId, generatedChildIds, runStamp }) {
  const removed = new Set(removedParentIds.filter(Boolean));
  const written = [];
  for (const parentTodoId of removed) {
    written.push(writeTodoReplanRecord({
      parentTodoId,
      replacementSourceTodoId,
      generatedChildIds: generatedChildIds.filter(Boolean),
      reason: 'brownie_owned_blocker_refined_into_executable_children',
      runStamp
    }));
  }
  for (const record of readTodoReplanRecords()) {
    const parentTodoId = typeof record?.parent_todo_id === 'string' ? record.parent_todo_id.trim() : '';
    const children = Array.isArray(record?.generated_child_ids)
      ? record.generated_child_ids.map((child) => String(child).trim()).filter(Boolean)
      : [];
    if (!parentTodoId || !children.some((child) => removed.has(child))) {
      continue;
    }
    written.push(writeTodoReplanRecord({
      parentTodoId,
      replacementSourceTodoId,
      generatedChildIds: generatedChildIds.filter(Boolean),
      reason: 'transitive_brownie_owned_blocker_refinement_replaced_prior_replan_children',
      runStamp
    }));
  }
  return written;
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
  const pattern = /^(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+/gm;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    starts.push(match.index);
  }
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : text.length;
    return text.slice(start, end).trimEnd();
  }).filter((block) => /^(?:[-*]|\d+[.)])\s+\[\s\]\s+/u.test(block));
}

function checkedTodoBlocks(text) {
  const starts = [];
  const pattern = /^(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+/gm;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    starts.push(match.index);
  }
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : text.length;
    return text.slice(start, end).trimEnd();
  }).filter((block) => /^(?:[-*]|\d+[.)])\s+\[[xX]\]\s+/u.test(block));
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

function routeValue(block) {
  const line = block
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('Route:'));
  return line?.slice('Route:'.length).trim().replace(/[.]$/u, '').toLowerCase() ?? '';
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

function createOnlyScopes(block) {
  const first = firstLine(block);
  const start = first.indexOf('Create only');
  if (start < 0) {
    return [];
  }
  const rest = first.slice(start + 'Create only'.length);
  return [...rest.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function boundedScopes(block) {
  return [...patchOnlyScopes(block), ...createOnlyScopes(block)];
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

function replaceDependencyReference(todoText, fromId, toId) {
  const escaped = fromId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return todoText.replace(
    new RegExp(`(^\\s*Depends on:\\s*)([^\\n]*\\b)${escaped}(\\b[^\\n]*$)`, 'gmu'),
    (_match, prefix, before, after) => `${prefix}${before}${toId}${after}`
  );
}

function replaceDependencyReferenceWithNone(todoText, fromId) {
  const escaped = fromId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return todoText.replace(
    new RegExp(`(^\\s*Depends on:\\s*)${escaped}(\\.\\s*$)`, 'gmu'),
    '$1<none>.'
  );
}

function sourceTodoId(block) {
  const line = block
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('Source TODO:'));
  if (!line) {
    return null;
  }
  return line.slice('Source TODO:'.length).trim().split(':')[0]?.trim().replace(/[.,;]+$/u, '') || null;
}

function renderDirectoryScopeDecompositionLeaf({ selectedId, sourceId, directoryScopes }) {
  const repairId = `${selectedId}-decompose-targets`;
  const scopeText = directoryScopes.map((scope) => `\`${scope}\``).join(', ');
  return {
    id: repairId,
    block: [
      `- [ ] ${repairId}: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to decompose directory-scoped TODO ${selectedId} into concrete file-specific leaves:`,
      '  Route: todo-decomposition.',
      `  Source TODO: ${sourceId ?? selectedId}.`,
      '  Depends on: <none>.',
      `  Completion condition: Brownie replaces the directory target ${scopeText} with executable single-file Patch only/Create only leaves, each with existing verification commands and without implementing the underlying Release work in this decomposition pass.`,
      '  Forbidden changes: do not edit implementation, documentation, or Release evidence files outside `.brownie/todo.md` and `.brownie/todo-breakdown.md`; do not declare Runtime Product Ready.',
      '  Verification: run `pnpm --workspace-root guard:todo-decomposition`.'
    ].join('\n')
  };
}

function defaultLeavesForDirectoryScopeRepair(sourceId, selectedId) {
  if (sourceId === 'E-21c-release-ops-todo-split') {
    return releaseOpsTodoSplitLeaves(sourceId, selectedId);
  }
  const recipes = new Map([
    ['E-21a-clean-release-workspace-contract', [
      ['scripts/guard-release-contract.mjs', 'scripts/guard-release-contract.test.mjs', ['pnpm --workspace-root guard:release-contract:test', 'pnpm --workspace-root guard:release-contract']]
    ]],
    ['E-21b-release-workspace-guard', [
      ['scripts/guard-release-contract.mjs', 'scripts/guard-release-contract.test.mjs', ['pnpm --workspace-root guard:release-contract:test', 'pnpm --workspace-root guard:release-contract']]
    ]],
    ['E-21d-generation-consistency-guard', [
      ['scripts/guard-release-evidence-semantic-consistency.mjs', 'scripts/guard-release-evidence-semantic-consistency.test.mjs', ['pnpm --workspace-root guard:release-evidence-semantic-consistency:test', 'pnpm --workspace-root guard:release-evidence-semantic-consistency']]
    ]],
    ['E-21e-owner-governance-reproducibility', [
      ['scripts/guard-owner-governance-evidence.mjs', 'scripts/guard-owner-governance-evidence.test.mjs', ['pnpm --workspace-root guard:owner-governance-evidence:test', 'pnpm --workspace-root guard:owner-governance-evidence']]
    ]]
  ]);
  const recipe = recipes.get(sourceId);
  if (!recipe) {
    return null;
  }
  return recipe.map((entry, index) => {
    const [targetA, targetB, verification] = entry;
    const leafId = `${sourceId}-scripts-leaf-${String.fromCharCode('a'.charCodeAt(0) + index)}`;
    return {
      id: leafId,
      firstLine: `- [ ] ${leafId}: Patch only \`${targetA}\` and \`${targetB}\` to implement the script-specific slice requested by ${selectedId}:`,
      route: 'implementation',
      source: sourceId,
      depends: index === 0 ? '<none>' : `${sourceId}-scripts-leaf-${String.fromCharCode('a'.charCodeAt(0) + index - 1)}`,
      completion: `The script-specific ${sourceId} slice is implemented in ${targetA} and ${targetB} without changing unrelated Release evidence state.`,
      forbidden: 'do not edit unrelated files, do not invent release evidence values, and do not declare Runtime Product Ready.',
      verification
    };
  });
}

function releaseOpsTodoSplitLeaves(sourceId, selectedId) {
  const topics = [
    ['clean-release-workspace', 'clean Release workspace setup and source checkout identity are defined as owner-visible Release Ops evidence before artifact generation starts'],
    ['artifact-e2e-smoke', 'all target artifacts have a required E2E smoke evidence slot for Base Mode Pack load, minimal task run, ledger generation, resume, and stale/replay rejection'],
    ['artifact-lifecycle', 'install, update, rollback, and uninstall lifecycle evidence is tracked per target without treating version-only CLI checks as lifecycle proof'],
    ['golden-journey', 'Golden Journey evidence is generated from a temporary workspace with observable workspace mutation instead of reusing the dirty development workspace'],
    ['stateful-soak', 'stateful soak evidence covers ledger/workspace consistency, resume/replay, duplicate side-effect rejection, process-loss recovery, and finite convergence'],
    ['provenance-binding', 'artifact SHA, source commit, workflow/run identity, and clean tree status are bound together before Release Contract trace fields can be populated'],
    ['owner-governance-reproducibility', 'branch protection, required checks, protected tags, and owner governance collectors produce reproducible evidence instead of environment-dependent unavailable results'],
    ['document-generation-sync', 'Release Contract, Readiness Audit, Phase Manifest, Final Judgment, and TODO blocker generation are synchronized after executable evidence is collected']
  ];
  return topics.map(([suffix, completion], index) => {
    const id = `${sourceId}-${suffix}`;
    return {
      id,
      firstLine: `- [ ] ${id}: Blocker: ${completion}:`,
      route: 'release-ops',
      source: sourceId,
      depends: index === 0 ? '<none>' : `${sourceId}-${topics[index - 1][0]}`,
      completion: `Release Ops has a concrete fail-closed evidence item for ${completion}, and Product Ready remains false until that evidence is produced and bound to the current release commit.`,
      forbidden: 'do not patch implementation files for this Release Ops blocker, do not invent evidence values, and do not declare Runtime Product Ready.',
      verificationText: 'Verification: blocker: Release Ops evidence remains fail-closed until this item is replaced by generated evidence or by a bounded implementation TODO with existing verification.'
    };
  });
}

function appendLeafToBreakdown({ breakdownText, leafId, parentId, history }) {
  const sectionHeader = `## TODO-repair-${leafId}`;
  if (breakdownText.includes(sectionHeader)) {
    return breakdownText;
  }
  const section = [
    sectionHeader,
    '',
    `Parent TODO: ${parentId}`,
    '',
    'Dependency graph:',
    `- ${leafId}: <none>`,
    '',
    'Verification ledger:',
    `- ${leafId}: run \`pnpm --workspace-root guard:todo-decomposition\``,
    '',
    'Quality rubric:',
    `- ${leafId}: bounded TODO repair scope, valid Source TODO, existing verification command, and no Product Ready declaration.`,
    '',
    'History:',
    '',
    `- ${new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')}: ${history}`
  ].join('\n');
  return `${breakdownText.trimEnd()}\n\n${section}\n`;
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
    `  ${leaf.verificationText ?? joinCommands(leaf.verification)}`
  ].join('\n');
}

function repairBreakdownOnlyLeaf({ selectedBlock, selectedId, todoText, breakdownText, todoPath, breakdownPath }) {
  const scopes = boundedScopes(selectedBlock);
  if (routeValue(selectedBlock) !== 'todo-decomposition' || scopes.length !== 1 || scopes[0] !== '.brownie/todo-breakdown.md') {
    return { applied: false, eligible: false, reason: 'selected_leaf_is_not_breakdown_only_update' };
  }
  const sourceId = sourceTodoId(selectedBlock);
  if (!sourceId) {
    return { applied: false, eligible: false, reason: 'breakdown_update_source_missing', selectedId };
  }
  const sectionHeader = `## TODO-repair-${selectedId}`;
  const parentLine = `Parent TODO: ${sourceId}`;
  const sectionAlreadyPresent = breakdownText.includes(sectionHeader) || breakdownText.includes(parentLine);
  const relatedBlocks = uncheckedTodoBlocks(todoText)
    .filter((block) => sourceTodoId(block) === sourceId)
    .filter((block) => todoId(block));
  const leafIds = relatedBlocks.length > 0 ? relatedBlocks.map(todoId) : [selectedId];
  const graph = leafIds.map((id) => {
    const block = relatedBlocks.find((candidate) => todoId(candidate) === id);
    const deps = block ? parseDependsOn(block) : [];
    return `- ${id}: ${deps.length > 0 ? deps.join(', ') : '<none>'}`;
  }).join('\n');
  const ledger = leafIds.map((id) => {
    const block = relatedBlocks.find((candidate) => todoId(candidate) === id);
    const verification = block
      ?.split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('Verification:'))
      ?.replace(/^Verification:\s*/u, '') ?? 'inspect `.brownie/todo-breakdown.md` for generated entries';
    return `- ${id}: ${verification}`;
  }).join('\n');
  const rubric = leafIds.map((id) => `- ${id}: bounded TODO decomposition/breakdown maintenance leaf with existing verification and no Product Ready declaration.`).join('\n');
  const section = [
    sectionHeader,
    '',
    parentLine,
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
    `- ${new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')}: Deterministically added missing breakdown section for ${sourceId} after Brownie reached no_eligible_task on ${selectedId}.`
  ].join('\n');
  const updatedBreakdown = sectionAlreadyPresent ? breakdownText : `${breakdownText.trimEnd()}\n\n${section}\n`;
  const updatedTodo = (replaceFirst(todoText, selectedBlock, '') ?? todoText)
    .replace(/\n{3,}/gu, '\n\n')
    .trimEnd() + '\n';
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
      reason: 'breakdown_update_repair_failed_guard',
      selectedId,
      sourceId,
      validationErrors
    };
  }
  writeAtomic(todoPath, updatedTodo);
  writeAtomic(breakdownPath, updatedBreakdown);
  return {
    applied: true,
    operation: 'deterministic_breakdown_update_leaf_repair',
    selectedId,
    sourceId,
    leafIds,
    removedCompletedTodo: true,
    sectionAlreadyPresent,
    todoPath,
    breakdownPath
  };
}

function repairReleaseOpsDecompositionRequest({ selectedBlock, selectedId, todoText, breakdownText, todoPath, breakdownPath }) {
  if (!selectedId.startsWith('TODO-decompose-release-ops-blockers-') || routeValue(selectedBlock) !== 'todo-decomposition') {
    return { applied: false, eligible: false, reason: 'selected_todo_is_not_release_ops_decomposition_request' };
  }
  const blocks = uncheckedTodoBlocks(todoText).filter((block) => todoId(block) !== selectedId);
  const releaseOpsLeaves = blocks.filter((block) => {
    const route = routeValue(block);
    const lower = block.toLowerCase();
    return (route === 'release-ops' || route === 'blocker') && (lower.includes('blocker') || lower.includes('fail-closed'));
  });
  if (releaseOpsLeaves.length === 0) {
    return { applied: false, eligible: false, reason: 'release_ops_decomposition_has_no_leaf_or_blocker_outputs', selectedId };
  }
  const sectionHeader = `## TODO-repair-${selectedId}`;
  const parentLine = `Parent TODO: ${selectedId}`;
  let updatedBreakdown = breakdownText;
  if (!updatedBreakdown.includes(sectionHeader) && !updatedBreakdown.includes(parentLine)) {
    const leafIds = releaseOpsLeaves.map(todoId).filter(Boolean);
    const graph = leafIds.map((id) => {
      const block = releaseOpsLeaves.find((candidate) => todoId(candidate) === id);
      const deps = block ? parseDependsOn(block) : [];
      return `- ${id}: ${deps.length > 0 ? deps.join(', ') : '<none>'}`;
    }).join('\n');
    const ledger = leafIds.map((id) => {
      const block = releaseOpsLeaves.find((candidate) => todoId(candidate) === id);
      const verification = block
        ?.split('\n')
        .map((line) => line.trim())
        .find((line) => line.startsWith('Verification:'))
        ?.replace(/^Verification:\s*/u, '') ?? 'blocker: fail-closed release-ops evidence remains pending';
      return `- ${id}: ${verification}`;
    }).join('\n');
    const rubric = leafIds.map((id) => `- ${id}: release-ops leaf or explicit blocker output from ${selectedId}.`).join('\n');
    const section = [
      sectionHeader,
      '',
      parentLine,
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
      `- ${new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')}: Deterministically closed ${selectedId} because the live queue already contains release-ops leaves or explicit blockers and TODO guards pass.`
    ].join('\n');
    updatedBreakdown = `${updatedBreakdown.trimEnd()}\n\n${section}\n`;
  }
  const updatedTodo = (replaceFirst(todoText, selectedBlock, '') ?? todoText)
    .replace(/\n{3,}/gu, '\n\n')
    .trimEnd() + '\n';
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
      reason: 'release_ops_decomposition_repair_failed_guard',
      selectedId,
      validationErrors
    };
  }
  writeAtomic(todoPath, updatedTodo);
  writeAtomic(breakdownPath, updatedBreakdown);
  return {
    applied: true,
    operation: 'deterministic_release_ops_decomposition_request_repair',
    selectedId,
    leafIds: releaseOpsLeaves.map(todoId).filter(Boolean),
    removedCompletedTodo: true,
    todoPath,
    breakdownPath
  };
}

function releaseEvidenceRecipeForBlock(block) {
  const lower = block.toLowerCase();
  if (lower.includes('owner governance') || lower.includes('branch protection') || lower.includes('protected tags') || lower.includes('required checks')) {
    return {
      slug: 'owner-governance-reproducibility',
      targets: ['scripts/release-owner-governance-evidence.mjs', 'scripts/guard-owner-governance-evidence.test.mjs'],
      verification: ['pnpm --workspace-root release:owner-governance-evidence:test', 'pnpm --workspace-root guard:owner-governance-evidence'],
      completion: 'Owner governance evidence generation and validation are fail-closed and reproducible when GitHub API data is unavailable or stale.'
    };
  }
  if (lower.includes('provenance') || lower.includes('artifact sha') || lower.includes('source commit') || lower.includes('clean tree')) {
    return {
      slug: 'provenance-binding',
      targets: ['scripts/release-supply-chain-artifact-evidence.mjs', 'scripts/guard-supply-chain-artifact-evidence.test.mjs'],
      verification: ['pnpm --workspace-root guard:supply-chain-artifact-evidence:test', 'pnpm --workspace-root guard:supply-chain-artifact-evidence'],
      completion: 'Supply-chain evidence binds artifact identity, source commit, workflow/run identity, and clean tree status without accepting stale or dirty-source evidence.'
    };
  }
  if (lower.includes('document generation') || lower.includes('release contract') || lower.includes('readiness audit') || lower.includes('final judgment') || lower.includes('phase manifest')) {
    return {
      slug: 'document-generation-sync',
      targets: ['scripts/guard-release-evidence-semantic-consistency.mjs', 'scripts/guard-release-evidence-semantic-consistency.test.mjs'],
      verification: ['pnpm --workspace-root guard:release-evidence-semantic-consistency:test', 'pnpm --workspace-root guard:release-evidence-semantic-consistency'],
      completion: 'Release document generation consistency rejects generation drift between Contract, Audit, Phase Manifest, Final Judgment, and TODO blocker generation.'
    };
  }
  if (lower.includes('clean release workspace') || lower.includes('source checkout') || lower.includes('workspace setup')) {
    return {
      slug: 'clean-release-workspace',
      targets: ['scripts/release-supply-chain-artifact-evidence.mjs', 'scripts/guard-supply-chain-artifact-evidence.test.mjs'],
      verification: ['pnpm --workspace-root guard:supply-chain-artifact-evidence:test', 'pnpm --workspace-root guard:supply-chain-artifact-evidence'],
      completion: 'Release evidence requires a clean dedicated source checkout identity before artifact evidence can satisfy Product Ready gates.'
    };
  }
  return {
    slug: 'runtime-operational-evidence',
    targets: ['scripts/release-runtime-operational-evidence.mjs', 'scripts/guard-runtime-operational-evidence.test.mjs'],
    verification: ['pnpm --workspace-root release:runtime-operational-evidence:test', 'pnpm --workspace-root guard:runtime-operational-evidence'],
    completion: 'Runtime operational evidence models the requested release operation as executable fail-closed evidence instead of a blocker placeholder.'
  };
}

function brownieOwnedBlockerRefinementLeaves({ selectedId, blockerBlocks }) {
  const blockerIdToLeafId = new Map();
  for (const [index, block] of blockerBlocks.entries()) {
    const id = todoId(block);
    if (!id) {
      continue;
    }
    const recipe = releaseEvidenceRecipeForBlock(block);
    const prefix = id.match(/^([A-Z]+-\d+[a-z]?)/u)?.[1] ?? 'TODO';
    blockerIdToLeafId.set(id, `${prefix}-${recipe.slug}-impl-${index + 1}`);
  }
  return blockerBlocks.map((block, index) => {
    const blockerId = todoId(block);
    const recipe = releaseEvidenceRecipeForBlock(block);
    const leafId = blockerIdToLeafId.get(blockerId) ?? `${selectedId}-leaf-${index + 1}`;
    const scopes = recipe.targets.map((target) => `\`${target}\``).join(' and ');
    const deps = parseDependsOn(block)
      .map((dep) => blockerIdToLeafId.get(dep) ?? dep)
      .filter((dep) => dep !== blockerId);
    return {
      id: leafId,
      firstLine: `- [ ] ${leafId}: Patch only ${scopes} to replace Brownie-owned blocker ${blockerId} with executable Release evidence handling:`,
      route: 'implementation',
      source: selectedId,
      depends: deps.length > 0 ? deps.join(', ') : '<none>',
      completion: `${recipe.completion} The original ${blockerId} blocker is removed only because this leaf provides bounded implementation work with existing verification.`,
      forbidden: 'do not edit unrelated files, do not invent release evidence values, do not weaken fail-closed guards, and do not declare Runtime Product Ready.',
      verification: recipe.verification
    };
  });
}

function repairBrownieOwnedBlockerRefinementRequest({ selectedBlock, selectedId, todoText, breakdownText, todoPath, breakdownPath }) {
  if (!selectedId.startsWith('TODO-refine-brownie-owned-blockers-') || routeValue(selectedBlock) !== 'todo-decomposition') {
    return { applied: false, eligible: false, reason: 'selected_todo_is_not_brownie_owned_blocker_refinement_request' };
  }
  const blocks = uncheckedTodoBlocks(todoText);
  const blockerBlocks = blocks.filter((block) => {
    if (todoId(block) === selectedId) {
      return false;
    }
    const route = routeValue(block);
    const lower = block.toLowerCase();
    const externalAuthority = [
      'external release engineering ownership',
      'owner-controlled runtime release ops',
      'runtime release ops authority',
      'github release publication',
      'artifact upload/provenance',
      'release ops owner',
      'deployment credentials',
      'production deployment credentials',
      'provided by repository owner',
      'owner provides',
      'human review',
      'independent human review',
      'license key',
      'password',
      'token'
    ].some((signal) => lower.includes(signal));
    const brownieOwned = route === 'release-ops' &&
      !externalAuthority &&
      (lower.includes('evidence') || lower.includes('collector') || lower.includes('guard') || lower.includes('harness') || lower.includes('workspace') || lower.includes('artifact') || lower.includes('golden journey') || lower.includes('stateful soak') || lower.includes('provenance') || lower.includes('document generation') || lower.includes('reproducible'));
    return brownieOwned && (lower.includes('blocker') || lower.includes('fail-closed'));
  });
  if (blockerBlocks.length === 0) {
    return { applied: false, eligible: false, reason: 'brownie_owned_refinement_has_no_brownie_owned_blockers', selectedId };
  }
  const leaves = brownieOwnedBlockerRefinementLeaves({ selectedId, blockerBlocks });
  const replacedBlockerIds = new Set(blockerBlocks.map(todoId).filter(Boolean));
  const preservedBlockerBreakdownLeaves = blocks
    .filter((block) => todoId(block) !== selectedId && !replacedBlockerIds.has(todoId(block)))
    .filter((block) => sourceTodoId(block))
    .filter((block) => {
      const route = routeValue(block);
      const lower = block.toLowerCase();
      return (route === 'blocker' || route === 'release-ops') && (lower.includes('blocker') || lower.includes('fail-closed'));
    })
    .map((block) => {
      const id = todoId(block);
      const verification = block
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.startsWith('Verification:'))
        ?.replace(/^Verification:\s*/u, '') ?? 'blocker: external authority evidence remains pending';
      return {
        id,
        source: selectedId,
        depends: parseDependsOn(block).join(', ') || '<none>',
        verificationText: `Verification: ${verification}`
      };
    });
  let updatedTodo = replaceFirst(todoText, selectedBlock, `${leaves.map(renderLeaf).join('\n\n')}\n`);
  if (updatedTodo === null) {
    return { applied: false, eligible: true, reason: 'brownie_owned_refinement_selected_block_not_found', selectedId };
  }
  for (const block of blockerBlocks) {
    updatedTodo = replaceFirst(updatedTodo, block, '') ?? updatedTodo;
  }
  updatedTodo = updatedTodo.replace(/\n{3,}/gu, '\n\n').trimEnd() + '\n';
  const updatedBreakdown = upsertBreakdownSection({
    breakdownText,
    decompositionId: selectedId,
    sourceId: 'brownie-owned-blocker-refinement',
    leaves: [...leaves, ...preservedBlockerBreakdownLeaves],
    runStamp: new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
  });
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
      reason: 'brownie_owned_refinement_failed_guard',
      selectedId,
      validationErrors
    };
  }
  writeAtomic(todoPath, updatedTodo);
  writeAtomic(breakdownPath, updatedBreakdown);
  const replanRecordPaths = writeTransitiveReplanRecords({
    removedParentIds: blockerBlocks.map(todoId).filter(Boolean),
    replacementSourceTodoId: selectedId,
    generatedChildIds: leaves.map((leaf) => leaf.id),
    runStamp: new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
  });
  return {
    applied: true,
    operation: 'deterministic_brownie_owned_blocker_refinement_repair',
    selectedId,
    removedBlockerIds: blockerBlocks.map(todoId).filter(Boolean),
    leafIds: leaves.map((leaf) => leaf.id),
    replanRecordPaths,
    todoPath,
    breakdownPath
  };
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
  if (!selectedId) {
    return { applied: false, eligible: false, reason: 'selected_todo_is_not_repairable_leaf' };
  }
  const blocks = uncheckedTodoBlocks(todoText);
  const selectedBlock = blocks.find((block) => todoId(block) === selectedId);
  if (!selectedBlock) {
    return { applied: false, eligible: false, reason: 'selected_leaf_missing_from_todo', selectedId };
  }
  if (routeValue(selectedBlock) === 'todo-decomposition' && selectedId.endsWith('-decompose-targets')) {
    const sourceId = sourceTodoId(selectedBlock) ?? selectedId.replace(/-decompose-targets$/u, '');
    const leaves = defaultLeavesForDirectoryScopeRepair(sourceId, selectedId);
    if (!leaves) {
      return { applied: false, eligible: false, reason: 'todo_decomposition_target_repair_has_no_recipe', selectedId, sourceId };
    }
    const leafText = `${leaves.map(renderLeaf).join('\n\n')}\n`;
    let updatedTodo = replaceFirst(todoText, selectedBlock, leafText);
    if (updatedTodo === null) {
      return { applied: false, eligible: true, reason: 'todo_decomposition_target_not_found_by_exact_slice', selectedId, sourceId };
    }
    let supplementalReplanRecord = null;
    if (sourceId === 'E-21c-release-ops-todo-split') {
      const residualBlock = uncheckedTodoBlocks(updatedTodo).find((block) => todoId(block) === 'E-19k-remaining-release-evidence-blocker');
      if (residualBlock) {
        updatedTodo = replaceFirst(updatedTodo, residualBlock, '') ?? updatedTodo;
        supplementalReplanRecord = {
          parentTodoId: 'E-19k-remaining-release-evidence-blocker',
          replacementSourceTodoId: sourceId,
          generatedChildIds: leaves.map((leaf) => leaf.id),
          reason: 'deterministic_release_ops_residual_blocker_replaced_by_evidence_leaves'
        };
      }
    }
    updatedTodo = sourceId === 'E-21c-release-ops-todo-split'
      ? replaceDependencyReferenceWithNone(updatedTodo, selectedId)
      : replaceDependencyReference(updatedTodo, selectedId, leaves.at(-1).id);
    updatedTodo = updatedTodo.replace(/\n{3,}/gu, '\n\n').trimEnd() + '\n';
    const updatedBreakdown = upsertBreakdownSection({
      breakdownText,
      decompositionId: `TODO-decompose-${selectedId}`,
      sourceId,
      leaves,
      runStamp: new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
    });
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
        reason: 'todo_decomposition_target_repair_failed_guard',
        selectedId,
        sourceId,
        validationErrors
      };
    }
    writeAtomic(todoPath, updatedTodo);
    writeAtomic(breakdownPath, updatedBreakdown);
    const replanRecordPath = supplementalReplanRecord
      ? writeTodoReplanRecord({ ...supplementalReplanRecord, runStamp: claim.run_stamp ?? new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z') })
      : null;
    return {
      applied: true,
      operation: 'deterministic_todo_decomposition_target_repair',
      selectedId,
      sourceId,
      leafIds: leaves.map((leaf) => leaf.id),
      replanRecordPath,
      todoPath,
      breakdownPath
    };
  }
  const releaseOpsDecompositionRepair = repairReleaseOpsDecompositionRequest({ selectedBlock, selectedId, todoText, breakdownText, todoPath, breakdownPath });
  if (releaseOpsDecompositionRepair.applied || releaseOpsDecompositionRepair.eligible) {
    return releaseOpsDecompositionRepair;
  }
  const brownieOwnedBlockerRefinementRepair = repairBrownieOwnedBlockerRefinementRequest({ selectedBlock, selectedId, todoText, breakdownText, todoPath, breakdownPath });
  if (brownieOwnedBlockerRefinementRepair.applied || brownieOwnedBlockerRefinementRepair.eligible) {
    return brownieOwnedBlockerRefinementRepair;
  }
  const breakdownRepair = repairBreakdownOnlyLeaf({ selectedBlock, selectedId, todoText, breakdownText, todoPath, breakdownPath });
  if (breakdownRepair.applied || breakdownRepair.eligible) {
    return breakdownRepair;
  }
  if (selected.includes('TODO-decompose-broad-todo-') || selected.includes('Route: todo-decomposition')) {
    return { applied: false, eligible: false, reason: 'selected_todo_is_not_repairable_leaf' };
  }

  let normalizedBlock = selectedBlock;
  const notes = [];
  const directoryScopes = boundedScopes(selectedBlock).filter((target) => target.endsWith('/'));
  if (directoryScopes.length > 0) {
    const sourceId = sourceTodoId(selectedBlock) ?? selectedId;
    const repairLeaf = renderDirectoryScopeDecompositionLeaf({ selectedId, sourceId, directoryScopes });
    const updatedBreakdown = appendLeafToBreakdown({
      breakdownText,
      leafId: repairLeaf.id,
      parentId: sourceId,
      history: `Converted directory-scoped leaf ${selectedId} into a Brownie-owned decomposition TODO because concrete Patch only/Create only file targets are required.`
    });
    let updatedTodo = replaceFirst(todoText, selectedBlock, repairLeaf.block);
    if (updatedTodo === null) {
      return { applied: false, eligible: true, reason: 'directory_scope_leaf_not_found_by_exact_slice', selectedId, directoryScopes };
    }
    updatedTodo = updatedTodo.replace(/\n{3,}/gu, '\n\n').trimEnd() + '\n';
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
        reason: 'directory_scope_repair_failed_guard',
        selectedId,
        directoryScopes,
        validationErrors
      };
    }
    writeAtomic(todoPath, updatedTodo);
    writeAtomic(breakdownPath, updatedBreakdown);
    return {
      applied: true,
      operation: 'deterministic_directory_scope_leaf_repair',
      selectedId,
      repairId: repairLeaf.id,
      directoryScopes,
      todoPath,
      breakdownPath
    };
  }

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

function repairDanglingLiveDependencies({ todoText, breakdownText, todoPath, breakdownPath }) {
  const blocks = uncheckedTodoBlocks(todoText);
  const ids = existingIds(todoText);
  const notes = [];
  let updatedTodo = todoText;
  let updatedBreakdown = breakdownText;

  for (const block of blocks) {
    const id = todoId(block);
    if (!id) {
      continue;
    }
    const dependencies = parseDependsOn(block);
    const danglingDependencies = dependencies.filter((dependency) => !ids.has(dependency));
    const breakdownOnlyDependencies = danglingDependencies.filter((dependency) => breakdownText.includes(dependency));
    if (breakdownOnlyDependencies.length === 0) {
      continue;
    }
    const liveDependencies = dependencies.filter((dependency) => ids.has(dependency));
    const replaced = replaceDependsOn(block, liveDependencies);
    if (!replaced.changed) {
      continue;
    }
    const replacedTodo = replaceFirst(updatedTodo, block, replaced.block);
    if (replacedTodo === null) {
      return {
        applied: false,
        eligible: true,
        reason: 'dangling_dependency_block_not_found_by_exact_slice',
        todoId: id,
        removedDependencies: breakdownOnlyDependencies
      };
    }
    updatedTodo = replacedTodo;
    for (const removed of breakdownOnlyDependencies) {
      const graphPattern = new RegExp(`(^-\\s+${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*)${removed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*$)`, 'mu');
      updatedBreakdown = updatedBreakdown.replace(graphPattern, `$1${liveDependencies.join(', ') || '<none>'}$2`);
    }
    notes.push({
      todo_id: id,
      normalization: 'removed_breakdown_only_dependency',
      removed: breakdownOnlyDependencies,
      remaining: liveDependencies
    });
  }

  if (notes.length === 0) {
    return { applied: false, eligible: false, reason: 'no_dangling_live_dependencies' };
  }

  updatedTodo = updatedTodo.replace(/\n{3,}/gu, '\n\n').trimEnd() + '\n';
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
      reason: 'dangling_dependency_repair_failed_guard',
      normalizations: notes,
      validationErrors
    };
  }

  writeAtomic(todoPath, updatedTodo);
  writeAtomic(breakdownPath, updatedBreakdown);
  return {
    applied: true,
    operation: 'deterministic_dangling_dependency_repair',
    todoPath,
    breakdownPath,
    normalizations: notes
  };
}

function upsertBreakdownSection({ breakdownText, decompositionId, sourceId, leaves, runStamp }) {
  const sectionHeader = `## ${decompositionId}`;
  const graph = leaves.map((leaf) => `- ${leaf.id}: ${leaf.depends}`).join('\n');
  const ledger = leaves.map((leaf) => `- ${leaf.id}: ${(leaf.verificationText ?? joinCommands(leaf.verification)).replace(/^Verification: /u, '')}`).join('\n');
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
    if (leafRepair.reason === 'selected_leaf_missing_from_todo') {
      const dependencyRepair = repairDanglingLiveDependencies({ todoText, breakdownText, todoPath, breakdownPath });
      if (dependencyRepair.applied || dependencyRepair.eligible) {
        return dependencyRepair;
      }
    }
    return leafRepair;
  }
  const dependencyRepair = repairDanglingLiveDependencies({ todoText, breakdownText, todoPath, breakdownPath });
  if (dependencyRepair.applied || dependencyRepair.eligible) {
    return dependencyRepair;
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
