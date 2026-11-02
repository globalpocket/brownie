#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  buildContractRebaselineReceipt,
  contractChanges,
  protectedContract,
  readContractRebaselineRecords,
  writeContractRebaselineReceipt
} from './phase-loop-todo-contract-rebaseline.mjs';
import { boundedScopeEntries } from './phase-loop-bounded-scope.mjs';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith('--')) args[argv[index].slice(2)] = argv[++index];
  }
  return args;
}

function gitShow(repoRoot, ref, relativePath) {
  return execFileSync('git', ['show', `${ref}:${relativePath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function legacyCaptureSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath, 'utf8').trim(), 'utf8').digest('hex');
}

function scopeMap(firstLine) {
  const result = new Map();
  for (const entry of boundedScopeEntries(firstLine)) {
    if (result.has(entry.path)) throw new Error(`duplicate bounded scope: ${entry.path}`);
    result.set(entry.path, entry.operation);
  }
  return result;
}

function gitValue(repoRoot, args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function gitHistoryUnavailable(id, subject, revision) {
  return new Error(`${id}: receipt Git history unavailable for ${subject} ${revision}; fetch complete history (for example actions/checkout with fetch-depth: 0)`);
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function todoBlocks(text) {
  const source = String(text ?? '');
  const starts = [...source.matchAll(/^(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+/gmu)].map((match) => match.index);
  return starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length).trimEnd());
}

function todoId(block) {
  return String(block ?? '').split('\n')[0]
    .trim()
    .replace(/^(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+/u, '')
    .split(':')[0]
    ?.trim() ?? '';
}

function receiptLine(block) {
  const lines = String(block ?? '').split('\n').map((line) => line.trim()).filter((line) => line.startsWith('Materialization receipt:'));
  if (lines.length !== 1) return null;
  const match = lines[0].match(/^Materialization receipt: Git merged Create-to-Patch v1; TODO ([A-Za-z][A-Za-z0-9_.-]*); PR #([1-9][0-9]*); merge commit ([a-f0-9]{40}); PR head ([a-f0-9]{40}); targets (.+)\.$/u);
  if (!match) return { error: 'malformed Git merged Create-to-Patch receipt' };
  const targets = [...match[5].matchAll(/`([^`@]+)@([a-f0-9]{40})`/gu)].map((entry) => ({ path: entry[1], blob: entry[2] }));
  const canonicalTargets = targets.map((target) => `\`${target.path}@${target.blob}\``).join(', ');
  if (targets.length === 0 || canonicalTargets !== match[5] || new Set(targets.map((target) => target.path)).size !== targets.length) {
    return { error: 'malformed Git merged Create-to-Patch target evidence' };
  }
  return { todo_id: match[1], pr_number: match[2], merge_commit: match[3], pr_head: match[4], targets };
}

function operationClauses(firstLine) {
  const matches = [...String(firstLine ?? '').matchAll(/\b(Patch|Create) only\s+/giu)];
  return matches.map((match, index) => {
    const end = matches[index + 1]?.index ?? String(firstLine).length;
    const clause = String(firstLine).slice(match.index, end);
    return {
      start: match.index,
      operation: match[1].toLowerCase(),
      paths: [...clause.matchAll(/`([^`]+)`/gu)].map((entry) => entry[1])
    };
  });
}

function restoreCreateOnlyFirstLine(afterFirstLine, targets) {
  const targetSet = new Set(targets);
  const clauses = operationClauses(afterFirstLine);
  const conversionStarts = new Set();
  for (const target of targetSet) {
    const clause = clauses.find((candidate) => candidate.operation === 'patch' && candidate.paths.includes(target));
    if (!clause) throw new Error(`receipt target is not a Patch-only scope: ${target}`);
    if (clause.paths.some((path) => !targetSet.has(path))) {
      throw new Error(`receipt must cover the complete Patch-only clause: ${target}`);
    }
    conversionStarts.add(clause.start);
  }
  let offset = 0;
  let before = String(afterFirstLine);
  for (const start of [...conversionStarts].sort((left, right) => left - right)) {
    const at = start + offset;
    if (before.slice(at, at + 11).toLowerCase() !== 'patch only ') throw new Error('receipt Patch-only clause is not stable');
    before = `${before.slice(0, at)}Create only ${before.slice(at + 11)}`;
    offset += 1;
  }
  return before;
}

function replaceFirstLine(block, firstLine) {
  const lines = String(block).split('\n');
  lines[0] = firstLine;
  return lines.filter((line) => !line.trim().startsWith('Materialization receipt:')).join('\n');
}

function gitBlob(repoRoot, revision, target) {
  return gitValue(repoRoot, ['rev-parse', `${revision}:${target}`]);
}

function worktreeBlob(repoRoot, target) {
  return gitValue(repoRoot, ['hash-object', '--path', target, target]);
}

// Public, source-controlled receipts are intentionally separate from the
// private preclaim receipts. They only admit a historical Create-to-Patch
// conversion when the recorded merged PR head is the merge commit's second
// parent and every target is absent from the first parent yet byte-identical
// to both the merge tree and current worktree.
export function readGitMaterializedScopeRebaselineRecords(repoRoot, todoText = null) {
  const text = todoText ?? fs.readFileSync(path.join(repoRoot, '.brownie/todo.md'), 'utf8');
  const records = [];
  for (const block of todoBlocks(text)) {
    const receipt = receiptLine(block);
    if (!receipt) continue;
    const id = todoId(block);
    if (receipt.error) throw new Error(`${id || '<missing>'}: ${receipt.error}`);
    if (id !== receipt.todo_id) throw new Error(`${id}: receipt TODO binding mismatch`);
    const parentLine = gitValue(repoRoot, ['rev-list', '--parents', '-n', '1', receipt.merge_commit]);
    if (!parentLine) throw gitHistoryUnavailable(id, 'merge commit', receipt.merge_commit);
    const parents = parentLine.split(/\s+/u);
    if (parents.length !== 3) {
      if (gitValue(repoRoot, ['rev-parse', '--is-shallow-repository']) === 'true') {
        throw gitHistoryUnavailable(id, 'merge parents of', receipt.merge_commit);
      }
      throw new Error(`${id}: receipt merge commit must have exactly two parents`);
    }
    const [, firstParent, secondParent] = parents;
    if (secondParent !== receipt.pr_head) throw new Error(`${id}: receipt PR head is not the merged implementation parent`);
    const targetPaths = receipt.targets.map((target) => target.path);
    const beforeFirstLine = restoreCreateOnlyFirstLine(protectedContract(block).first_line, targetPaths);
    const beforeBlock = replaceFirstLine(block, beforeFirstLine);
    const beforeContract = protectedContract(beforeBlock);
    const afterContract = protectedContract(block);
    for (const target of receipt.targets) {
      if (!target.path || path.isAbsolute(target.path) || target.path.includes('..')) throw new Error(`${id}: receipt target path is invalid: ${target.path}`);
      if (gitBlob(repoRoot, firstParent, target.path) !== null) throw new Error(`${id}: receipt target exists in merge first parent: ${target.path}`);
      if (gitBlob(repoRoot, receipt.merge_commit, target.path) !== target.blob) throw new Error(`${id}: receipt target digest mismatch at merge commit: ${target.path}`);
      if (worktreeBlob(repoRoot, target.path) !== target.blob) throw new Error(`${id}: receipt target digest mismatch in current worktree: ${target.path}`);
    }
    records.push({
      schema_version: 1,
      record_type: 'todo_contract_rebaseline',
      status: 'approved',
      approval: 'git_merged_create_to_patch_materialization',
      parent_todo_ids: [],
      target_todo_ids: [id],
      // `bounded_scopes` intentionally projects paths, not operations. The
      // operation-only Create→Patch change is therefore represented by the
      // immutable rendered first line alone.
      contract_changes: [{ todo_id: id, changed_fields: ['first_line'], before_contract: beforeContract, after_contract: afterContract }],
      cause_run: { run_stamp: `git-merge-${receipt.merge_commit.slice(0, 12)}`, event_key: `pr-${receipt.pr_number}`, diagnostic_sha256: sha256Text(JSON.stringify(receipt)) },
      verification: { repair_command: 'node scripts/phase-loop-admit-materialized-scope-rebaseline.mjs', guard_command: 'node scripts/guard-todo-decomposition.mjs', integrity_command: 'pnpm -s phase-loop:todo-queue-integrity', guard_passed: true },
      target_snapshots: receipt.targets.map((target) => ({ operation: 'Create', path: target.path, exists_before: false, sha256_before: null, exists_after: true, sha256_after: sha256File(path.join(repoRoot, target.path)) })),
      target_capture: { mode: 'git_merged_create_materialization', implementation_pr: Number(receipt.pr_number), implementation_pr_head: receipt.pr_head, implementation_merge_commit: receipt.merge_commit }
    });
  }
  return records;
}

function capturedPlaceholder(records, todoId, targetPath, targetSha256Candidates) {
  return records.some((record) => record?.target_capture?.mode === 'legacy_pre_capture_materialization'
    && record?.target_todo_ids?.includes(todoId)
    && record?.target_snapshots?.some((snapshot) => snapshot.operation === 'Create'
      && snapshot.path === targetPath
      && snapshot.exists_after === true
      && targetSha256Candidates.includes(snapshot.sha256_after)));
}

export function validateMaterializedScopeRebaseline({ beforeContract, afterContract, repoRoot, records }) {
  for (const field of ['id', 'route', 'depends_on', 'completion_condition', 'forbidden_changes', 'verification']) {
    if (beforeContract[field] !== afterContract[field]) {
      throw new Error(`materialized scope rebaseline may not change ${field}`);
    }
  }
  const beforeScopes = scopeMap(beforeContract.first_line);
  const afterScopes = scopeMap(afterContract.first_line);
  if (beforeScopes.size !== afterScopes.size || [...beforeScopes.keys()].some((target) => !afterScopes.has(target))) {
    throw new Error('materialized scope rebaseline may not add, remove, or replace bounded targets');
  }
  const converted = [];
  for (const [target, beforeOperation] of beforeScopes) {
    const afterOperation = afterScopes.get(target);
    if (beforeOperation === afterOperation) continue;
    if (beforeOperation !== 'create' || afterOperation !== 'patch') {
      throw new Error(`materialized scope rebaseline only permits Create-to-Patch: ${target}`);
    }
    const absoluteTarget = path.join(repoRoot, target);
    if (!fs.existsSync(absoluteTarget)) throw new Error(`materialized target is absent: ${target}`);
    const sha256 = sha256File(absoluteTarget);
    // Legacy pre-capture records hashed trimmed text. Restrict compatibility
    // to that record mode and retain the raw current file hash in the new
    // receipt so all future comparisons are byte exact.
    const legacySha256 = legacyCaptureSha256(absoluteTarget);
    if (!capturedPlaceholder(records, afterContract.id, target, [sha256, legacySha256])) {
      throw new Error(`materialized target is not bound to a legacy placeholder capture: ${target}`);
    }
    converted.push({ operation: 'Patch', path: target, exists_before: true, sha256_before: sha256, exists_after: true, sha256_after: sha256 });
  }
  if (converted.length === 0) throw new Error('materialized scope rebaseline requires a Create-to-Patch transition');
  return converted;
}

export function admitMaterializedScopeRebaseline({ repoRoot, baselineRef, todoId, runStamp, eventKey, diagnostic }) {
  if (!todoId || !runStamp || !eventKey || !diagnostic) throw new Error('todo id, run stamp, event key, and diagnostic are required');
  const beforeTodoText = gitShow(repoRoot, baselineRef, '.brownie/todo.md');
  const beforeBreakdownText = gitShow(repoRoot, baselineRef, '.brownie/todo-breakdown.md');
  const afterTodoText = fs.readFileSync(path.join(repoRoot, '.brownie/todo.md'), 'utf8');
  const afterBreakdownText = fs.readFileSync(path.join(repoRoot, '.brownie/todo-breakdown.md'), 'utf8');
  const changes = contractChanges({ beforeTodoText, afterTodoText, todoIds: [todoId] });
  if (changes.length !== 1 || changes[0].todo_id !== todoId) throw new Error(`expected one changed contract for ${todoId}`);
  const change = changes[0];
  // Operations are intentionally absent from `bounded_scopes`. A pure
  // Create-to-Patch conversion changes only the rendered line; a harmless
  // clause reordering also changes the ordered path projection. The map
  // validation below still requires exactly the same target set.
  const supportedDrift = JSON.stringify(change.changed_fields) === JSON.stringify(['first_line'])
    || JSON.stringify(change.changed_fields) === JSON.stringify(['first_line', 'bounded_scopes']);
  if (!supportedDrift) {
    throw new Error(`unsupported materialized scope contract drift: ${change.changed_fields.join(', ')}`);
  }
  const targetSnapshots = validateMaterializedScopeRebaseline({
    beforeContract: change.before_contract,
    afterContract: change.after_contract,
    repoRoot,
    records: readContractRebaselineRecords(repoRoot)
  });
  execFileSync(process.execPath, ['scripts/guard-todo-decomposition.mjs'], { cwd: repoRoot, stdio: 'ignore' });
  const receipt = buildContractRebaselineReceipt({
    repoRoot,
    beforeTodoText,
    afterTodoText,
    beforeBreakdownText,
    afterBreakdownText,
    todoIds: [todoId],
    runStamp,
    eventKey,
    diagnostic,
    verification: {
      repair_command: 'node scripts/phase-loop-admit-materialized-scope-rebaseline.mjs',
      guard_command: 'node scripts/guard-todo-decomposition.mjs',
      integrity_command: 'pnpm -s phase-loop:todo-queue-integrity'
    },
    targetSnapshots,
    targetCapture: { mode: 'legacy_materialized_scope_operation_rebaseline', source: 'legacy_pre_capture_materialization' }
  });
  return { applied: true, receipt_path: writeContractRebaselineReceipt(repoRoot, receipt), target_snapshots: targetSnapshots };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    console.log(JSON.stringify(admitMaterializedScopeRebaseline({
      repoRoot: path.resolve(args.repo ?? process.cwd()),
      baselineRef: args['baseline-ref'] ?? 'HEAD',
      todoId: args['todo-id'],
      runStamp: args['run-stamp'],
      eventKey: args['event-key'],
      diagnostic: args.diagnostic
    }), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ applied: false, error: error?.message ?? String(error) }, null, 2));
    process.exit(1);
  }
}
