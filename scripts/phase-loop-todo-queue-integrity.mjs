#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { boundedScopes } from './phase-loop-bounded-scope.mjs';
import { execFileSync } from 'node:child_process';
import {
  readAllTodoReplanRecords,
  readTodoCompletionRecords,
  readTodoCompletionInvalidationRecords,
  readTrackedBreakdownReplanRecords,
  resolveTodoState
} from './phase-loop-todo-state.mjs';
import {
  matchesContractRebaselineChain,
  matchesContractRebaselineRecord,
  readContractRebaselineRecords
} from './phase-loop-todo-contract-rebaseline.mjs';

export { readTrackedBreakdownReplanRecords as trackedBreakdownReplanRecords };

const defaultTodoPath = '.brownie/todo.md';

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    todo: defaultTodoPath,
    breakdown: '.brownie/todo-breakdown.md'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo') {
      args.repo = argv[++index];
    } else if (arg === '--todo') {
      args.todo = argv[++index];
    } else if (arg === '--breakdown') {
      args.breakdown = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function git(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function gitHeadText(repoRoot, relativePath) {
  try {
    return git(repoRoot, ['show', `HEAD:${relativePath}`]);
  } catch {
    return null;
  }
}

function maybeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function uncheckedTodoBlocks(text) {
  return todoBlocksByCheckbox(text, /\s/u);
}

function checkedTodoBlocks(text) {
  return todoBlocksByCheckbox(text, /[xX]/u);
}

function todoBlocksByCheckbox(text, checkboxPattern) {
  const starts = [];
  const pattern = /^(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+/gm;
  let match;
  while ((match = pattern.exec(text ?? '')) !== null) {
    starts.push(match.index);
  }
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : text.length;
    return text.slice(start, end).trimEnd();
  }).filter((block) => new RegExp(`^(?:[-*]|\\d+[.)])\\s+\\[${checkboxPattern.source}\\]\\s+`, 'u').test(block));
}

function todoId(block) {
  const firstLine = block.split('\n')[0]?.trim() ?? '';
  const title = firstLine.replace(/^(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+/, '');
  return title.split(':')[0]?.trim() ?? '';
}

function blockMap(text) {
  const map = new Map();
  for (const block of uncheckedTodoBlocks(text ?? '')) {
    const id = todoId(block);
    if (id) {
      map.set(id, block);
    }
  }
  return map;
}

function checkedTodoIds(text) {
  return new Set(checkedTodoBlocks(text ?? '').map(todoId).filter(Boolean));
}

function firstLine(block) {
  return block.split('\n')[0]?.trim() ?? '';
}

function lineValue(block, label) {
  const prefix = `${label}:`;
  const line = block
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  return line ? line.slice(prefix.length).trim().replace(/[.]$/, '') : '';
}

function sourceTodoId(block) {
  const source = lineValue(block, 'Source TODO');
  return source.split(':')[0]?.trim().replace(/[.,;]+$/u, '') ?? '';
}

function normalizedDependencies(value) {
  return String(value ?? '')
    .replace(/[.]$/u, '')
    .split(/\s*,\s*/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry !== '<none>')
    .sort();
}

// The breakdown is durable decomposition evidence, not merely prose.  A
// mismatch here can make the scheduler select a test leaf before its required
// implementation leaf, so validate every live TODO that has a graph entry.
function breakdownDependencies(text) {
  const dependencies = new Map();
  let inGraph = false;
  for (const line of String(text ?? '').split('\n')) {
    if (line.trim() === 'Dependency graph:') {
      inGraph = true;
      continue;
    }
    if (!inGraph) continue;
    if (/^#{1,6}\s/u.test(line) || line.trim() === 'Verification ledger:' || line.trim() === 'History:' || line.trim() === 'Quality rubric:') {
      inGraph = false;
      continue;
    }
    const match = line.match(/^-\s+([^:]+):\s*(.*?)\s*$/u);
    if (match) {
      const id = match[1].trim();
      const values = dependencies.get(id) ?? [];
      values.push(normalizedDependencies(match[2]));
      dependencies.set(id, values);
    }
  }
  return dependencies;
}

function protectedContract(block) {
  return {
    id: todoId(block),
    first_line: firstLine(block),
    route: lineValue(block, 'Route').toLowerCase(),
    depends_on: lineValue(block, 'Depends on'),
    completion_condition: lineValue(block, 'Completion condition'),
    forbidden_changes: lineValue(block, 'Forbidden changes'),
    verification: lineValue(block, 'Verification'),
    bounded_scopes: boundedScopes(firstLine(block))
  };
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function contractDrift(before, after) {
  const beforeContract = protectedContract(before);
  const afterContract = protectedContract(after);
  const drifts = [];
  for (const key of ['id', 'first_line', 'route', 'depends_on', 'completion_condition', 'forbidden_changes', 'verification']) {
    if (beforeContract[key] !== afterContract[key]) {
      drifts.push(key);
    }
  }
  if (!sameArray(beforeContract.bounded_scopes, afterContract.bounded_scopes)) {
    drifts.push('bounded_scopes');
  }
  return drifts;
}

function replanRecordsByParent(records) {
  const map = new Map();
  for (const record of records ?? []) {
    const parent = typeof record.parent_todo_id === 'string' ? record.parent_todo_id.trim() : '';
    const children = Array.isArray(record.generated_child_ids)
      ? record.generated_child_ids.map((child) => String(child).trim()).filter(Boolean)
      : [];
    if (!parent || children.length === 0) {
      continue;
    }
    if (!map.has(parent)) {
      map.set(parent, []);
    }
    map.get(parent).push({ ...record, parent_todo_id: parent, generated_child_ids: children });
  }
  return map;
}

function validReplanForRemovedParent(record, after, replanByParent = new Map(), completedIds = new Set(), ancestry = []) {
  if (record.parent_status !== 'superseded_by_children') {
    return {
      valid: false,
      reason: 'parent_status_must_be_superseded_by_children'
    };
  }
  const children = record.generated_child_ids;
  if (new Set(children).size !== children.length) {
    return {
      valid: false,
      reason: 'generated_child_ids_must_be_unique'
    };
  }
  const missing = [];
  const wrongSource = [];
  const transitive = [];
  if (ancestry.includes(record.parent_todo_id)) {
    return {
      valid: false,
      reason: 'replan_cycle_detected',
      cycle: [...ancestry, record.parent_todo_id]
    };
  }
  const acceptedSourceTodoIds = new Set([record.parent_todo_id]);
  if (typeof record.replacement_source_todo_id === 'string' && record.replacement_source_todo_id.trim()) {
    acceptedSourceTodoIds.add(record.replacement_source_todo_id.trim());
  }
  for (const child of children) {
    const block = after.get(child);
    if (!block) {
      const childReplans = replanByParent.get(child) ?? [];
      const acceptedChildReplan = childReplans.find((childRecord) => {
        const result = validReplanForRemovedParent(childRecord, after, replanByParent, completedIds, [...ancestry, record.parent_todo_id]);
        return result.valid;
      });
      if (acceptedChildReplan) {
        transitive.push(child);
        continue;
      }
      if (completedIds.has(child)) {
        continue;
      }
      missing.push(child);
      continue;
    }
    if (!acceptedSourceTodoIds.has(sourceTodoId(block))) {
      wrongSource.push(child);
    }
  }
  if (missing.length > 0 || wrongSource.length > 0) {
    return {
      valid: false,
      reason: 'generated_children_not_live_or_not_linked_to_parent',
      missing_child_ids: missing,
      wrong_source_child_ids: wrongSource
    };
  }
  return { valid: true };
}

export function validateTodoQueueIntegrity({
  todoBefore,
  todoAfter,
  beforeBreakdownText = null,
  afterBreakdownText = null,
  completedTodoIds: completedIdsInput = [],
  resolvedTodoIds: resolvedIdsInput = [],
  knownTodoIds: knownIdsInput = undefined,
  unverifiedArchivedCompletionRecords = [],
  todoReplanRecords: todoReplanRecordsInput = [],
  contractRebaselineRecords: contractRebaselineRecordsInput = []
}) {
  const errors = [];
  const warnings = [];
  const before = blockMap(todoBefore ?? '');
  const after = blockMap(todoAfter ?? '');
  const completedIds = new Set([...completedIdsInput, ...checkedTodoIds(todoAfter)]);
  const resolvedIds = new Set([...resolvedIdsInput, ...completedIds]);
  const hasDurableKnownIds = Array.isArray(knownIdsInput);
  const knownIds = new Set([...(knownIdsInput ?? []), ...before.keys(), ...after.keys(), ...completedIds]);
  const replanByParent = replanRecordsByParent(todoReplanRecordsInput);
  const removedTodoIds = [];
  const changedTodoIds = [];
  const addedTodoIds = [];
  const replannedTodoIds = [];
  const breakdownDependenciesByTodo = breakdownDependencies(afterBreakdownText);
  const legacyCompletionByTodoId = new Map();
  for (const record of unverifiedArchivedCompletionRecords) {
    const id = typeof record?.selected_todo_id === 'string' ? record.selected_todo_id.trim() : '';
    if (!id) continue;
    if (!legacyCompletionByTodoId.has(id)) legacyCompletionByTodoId.set(id, []);
    legacyCompletionByTodoId.get(id).push({
      claim_id: typeof record.claim_id === 'string' ? record.claim_id : null,
      reason: typeof record.reason === 'string' ? record.reason : 'legacy_completion_record_without_delivery_receipt'
    });
  }

  for (const [id, block] of after.entries()) {
    const todoDependencies = normalizedDependencies(lineValue(block, 'Depends on'));
    // An unresolved live prerequisite is normal queue state; an absent
    // prerequisite is not.  The latter previously let a rewritten TODO point
    // at a vanished target and later appear schedulable after controller
    // churn.  A dependency may be absent from the live file only when durable
    // completion or supersession state still knows and resolves it.
    const missingDependencies = hasDurableKnownIds
      ? todoDependencies.filter((dependency) => !knownIds.has(dependency) && !resolvedIds.has(dependency))
      : [];
    if (missingDependencies.length > 0) {
      errors.push({
        code: 'todo_dependency_unknown_or_unresolved',
        message: 'A live TODO references a prerequisite that is absent from both the queue and durable completion/replan state.',
        todo_id: id,
        dependency_todo_ids: missingDependencies
      });
    }
    const unsafeDependencies = normalizedDependencies(lineValue(block, 'Depends on'))
      .filter((dependency) => legacyCompletionByTodoId.has(dependency));
    if (unsafeDependencies.length > 0) {
      errors.push({
        code: 'legacy_completion_dependency_requires_recovery',
        message: 'A pending TODO depends on an absent prerequisite backed only by an unverifiable legacy completion record; restore or invalidate the original claim before scheduling a descendant.',
        todo_id: id,
        dependency_todo_ids: unsafeDependencies,
        completion_records: Object.fromEntries(unsafeDependencies.map((dependency) => [dependency, legacyCompletionByTodoId.get(dependency)]))
      });
    }
    if (!breakdownDependenciesByTodo.has(id)) continue;
    const ledgerDependencyEntries = breakdownDependenciesByTodo.get(id);
    if (ledgerDependencyEntries.some((ledgerDependencies) => !sameArray(todoDependencies, ledgerDependencies))) {
      errors.push({
        code: 'todo_breakdown_dependency_mismatch',
        message: 'Live TODO dependencies must match the durable breakdown dependency graph before claim selection.',
        todo_id: id,
        todo_dependencies: todoDependencies,
        breakdown_dependencies: ledgerDependencyEntries
      });
    }
  }

  for (const id of after.keys()) {
    if (completedIds.has(id)) {
      errors.push({
        code: 'completed_todo_reappeared_in_live_queue',
        message: 'A TODO with durable completion evidence is still present as an unchecked live queue item.',
        todo_id: id
      });
    }
  }

  for (const [id, beforeBlock] of before.entries()) {
    const afterBlock = after.get(id);
    if (!afterBlock) {
      removedTodoIds.push(id);
      if (!completedIds.has(id)) {
        const replans = replanByParent.get(id) ?? [];
        const acceptedReplan = replans.find((record) => validReplanForRemovedParent(record, after, replanByParent, completedIds).valid);
        if (acceptedReplan) {
          replannedTodoIds.push(id);
          continue;
        }
        const rejectedReplan = replans.map((record) => validReplanForRemovedParent(record, after, replanByParent, completedIds)).find((result) => !result.valid);
        errors.push({
          code: 'todo_removed_without_completion_or_replan_record',
          message: 'A TODO was removed from the queue without durable completion or replan evidence.',
          todo_id: id,
          replan_rejection: rejectedReplan
        });
      }
      continue;
    }
    const drift = contractDrift(beforeBlock, afterBlock);
    if (drift.length > 0) {
      changedTodoIds.push(id);
      const beforeDependencies = lineValue(beforeBlock, 'Depends on')
        .split(/\s*,\s*/u).map((entry) => entry.trim()).filter((entry) => entry && entry !== '<none>');
      const afterDependencyValue = lineValue(afterBlock, 'Depends on');
      const afterDependencies = afterDependencyValue
        .split(/\s*,\s*/u).map((entry) => entry.trim()).filter((entry) => entry && entry !== '<none>');
      // Every protected field is immutable by default.  A controller-owned
      // deterministic repair may change one or more fields only when an exact
      // durable receipt binds the full before/after contracts.  This covers
      // Create-to-Patch materialization as well as dependency reconciliation;
      // neither path may rely on a broad drift exception.
      const beforeTodoSha256 = crypto.createHash('sha256').update(todoBefore ?? '', 'utf8').digest('hex');
      const afterTodoSha256 = crypto.createHash('sha256').update(todoAfter ?? '', 'utf8').digest('hex');
      const beforeBreakdownSha256 = beforeBreakdownText === null
        ? null
        : crypto.createHash('sha256').update(beforeBreakdownText, 'utf8').digest('hex');
      const afterBreakdownSha256 = afterBreakdownText === null
        ? null
        : crypto.createHash('sha256').update(afterBreakdownText, 'utf8').digest('hex');
      const beforeContract = protectedContract(beforeBlock);
      const afterContract = protectedContract(afterBlock);
      const approvedRecord = contractRebaselineRecordsInput.find((record) => matchesContractRebaselineRecord(record, {
        todoId: id,
        changedFields: drift,
        beforeContract,
        afterContract,
        beforeTodoSha256,
        afterTodoSha256,
        beforeBreakdownSha256,
        afterBreakdownSha256
      })) ?? matchesContractRebaselineChain(contractRebaselineRecordsInput, {
        todoId: id,
        beforeContract,
        afterContract
      });
      if (approvedRecord) {
        const isCompletedDependencyPrune = afterDependencyValue === '<none>'
          && afterDependencies.length === 0
          && beforeDependencies.every((dependency) => completedIds.has(dependency));
        if (drift.length === 1 && drift[0] === 'depends_on' && (afterDependencies.length > 0 || isCompletedDependencyPrune)) {
          const warning = {
            code: afterDependencies.length === 0
              ? 'completed_dependency_pruned_rebaseline'
              : 'todo_dependency_rebaselined',
            message: afterDependencies.length === 0
              ? 'A live TODO dependency was pruned only through an approved deterministic contract rebaseline with durable completion evidence.'
              : 'A live TODO dependency changed only through an approved deterministic contract rebaseline with durable decomposition evidence.',
            todo_id: id,
            pruned_dependency_ids: beforeDependencies,
            contract_rebaseline_run_stamp: approvedRecord.cause_run.run_stamp
          };
          if (afterDependencies.length > 0) warning.replacement_dependency_ids = afterDependencies;
          warnings.push(warning);
          continue;
        }
        warnings.push({
          code: 'todo_contract_rebaselined',
          message: 'A protected TODO contract changed only through an exact approved deterministic rebaseline receipt.',
          todo_id: id,
          changed_fields: drift,
          contract_rebaseline_run_stamp: approvedRecord.cause_run.run_stamp
        });
        continue;
      }
      errors.push({
        code: 'todo_contract_drift',
        message: 'A surviving TODO changed protected contract fields before claim selection.',
        todo_id: id,
        drift
      });
    }
  }

  for (const id of after.keys()) {
    if (!before.has(id)) {
      addedTodoIds.push(id);
    }
  }

  if (addedTodoIds.length > 0) {
    warnings.push({
      code: 'todo_queue_added_items',
      message: 'New TODOs were added to the queue; existing TODO contracts remain protected.',
      todo_ids: addedTodoIds
    });
  }

  return {
    schema_version: 1,
    valid: errors.length === 0,
    errors,
    warnings,
    removed_todo_ids: removedTodoIds,
    changed_todo_ids: changedTodoIds,
    added_todo_ids: addedTodoIds,
    replanned_todo_ids: replannedTodoIds,
    completed_todo_ids: [...completedIds].sort()
  };
}

export function loadCliInput(args) {
  const repoRoot = path.resolve(args.repo);
  const todoPath = path.resolve(repoRoot, args.todo);
  const todoRelative = path.relative(repoRoot, todoPath).split(path.sep).join('/');
  const breakdownPath = path.resolve(repoRoot, args.breakdown ?? '.brownie/todo-breakdown.md');
  const breakdownRelative = path.relative(repoRoot, breakdownPath).split(path.sep).join('/');
  const todoBefore = gitHeadText(repoRoot, todoRelative);
  const todoAfter = maybeReadText(todoPath);
  const breakdownBefore = gitHeadText(repoRoot, breakdownRelative);
  const breakdownAfter = maybeReadText(breakdownPath);
  const replanRecords = readAllTodoReplanRecords(repoRoot);
  const todoState = resolveTodoState({
    todoText: todoAfter,
    replanRecords,
    completionRecords: readTodoCompletionRecords(repoRoot),
    completionInvalidationRecords: readTodoCompletionInvalidationRecords(repoRoot)
  });
  return {
    repoRoot,
    todoRelative,
    breakdownRelative,
    todoBefore,
    todoAfter,
    beforeBreakdownText: breakdownBefore,
    afterBreakdownText: breakdownAfter,
    completedTodoIds: [...todoState.completedIds],
    resolvedTodoIds: [...todoState.resolvedIds],
    knownTodoIds: [...todoState.knownIds],
    unverifiedArchivedCompletionRecords: todoState.unverifiedCompletionRecords
      .filter((record) => todoState.unverifiedArchivedCompletionIds.has(record.selected_todo_id)),
    todoReplanRecords: replanRecords,
    contractRebaselineRecords: readContractRebaselineRecords(repoRoot)
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const input = loadCliInput(args);
    if (input.todoBefore === null || input.todoAfter === null) {
      const output = {
        schema_version: 1,
        valid: true,
        errors: [],
        warnings: [{
          code: 'todo_queue_integrity_baseline_unavailable',
          message: 'TODO queue integrity baseline is unavailable; skipping protected-contract comparison.',
          todo_path: input.todoRelative
        }]
      };
      console.log(JSON.stringify(output, null, 2));
      process.exit(0);
    }
    const validation = validateTodoQueueIntegrity(input);
    const output = JSON.stringify(validation, null, 2);
    if (validation.valid) {
      console.log(output);
      process.exit(0);
    }
    console.error(output);
    process.exit(1);
  } catch (error) {
    console.error(JSON.stringify({
      schema_version: 1,
      valid: false,
      errors: [{
        code: 'todo_queue_integrity_exception',
        message: error?.message ?? String(error)
      }]
    }, null, 2));
    process.exit(1);
  }
}
