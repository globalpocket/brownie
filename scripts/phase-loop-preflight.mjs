#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundedScopeEntries } from './phase-loop-bounded-scope.mjs';
import { bindExecutionContext } from './phase-loop-execution-context.mjs';
import { uncheckedTodoBlocks as claimSelectorTodoBlocks } from './guard-todo-decomposition.mjs';
import {
  matchesMaterializedTargetRebaselineChain,
  matchesMaterializedTargetRebaseline,
  protectedContract,
  readContractRebaselineRecords
} from './phase-loop-todo-contract-rebaseline.mjs';
import { readAllTodoReplanRecords, resolveTodoState } from './phase-loop-todo-state.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');

const releaseJsonFiles = [
  'docs/architecture/runtime-release-contract.json',
  'docs/architecture/runtime-release-readiness-audit.json',
  'docs/architecture/phase-value-manifest.json'
];

function parseArgs(argv) {
  const args = {
    repo: defaultRepoRoot,
    stage: 'general',
    claim: '.brownie/private/phase-loop/todo-claims/current.json',
    todo: '.brownie/todo.md',
    breakdown: '.brownie/todo-breakdown.md',
    controlPlaneRoot: null,
    stateRoot: null,
    cliRoot: null,
    runtimeRoot: null,
    baseCommit: null,
    expectedActor: null,
    contextAudit: null,
    controllerFingerprint: null,
    snapshotSource: null,
    snapshotAudit: null,
    profile: 'production',
    skipCommands: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo') {
      args.repo = argv[++index];
    } else if (arg === '--stage') {
      args.stage = argv[++index];
    } else if (arg === '--claim') {
      args.claim = argv[++index];
    } else if (arg === '--todo') {
      args.todo = argv[++index];
    } else if (arg === '--breakdown') {
      args.breakdown = argv[++index];
    } else if (arg === '--control-plane-root') {
      args.controlPlaneRoot = argv[++index];
    } else if (arg === '--state-root') {
      args.stateRoot = argv[++index];
    } else if (arg === '--cli-root') {
      args.cliRoot = argv[++index];
    } else if (arg === '--runtime-root') {
      args.runtimeRoot = argv[++index];
    } else if (arg === '--base-commit') {
      args.baseCommit = argv[++index];
    } else if (arg === '--expected-actor') {
      args.expectedActor = argv[++index];
    } else if (arg === '--context-audit') {
      args.contextAudit = argv[++index];
    } else if (arg === '--controller-fingerprint') {
      args.controllerFingerprint = argv[++index];
    } else if (arg === '--snapshot-source') {
      args.snapshotSource = argv[++index];
    } else if (arg === '--snapshot-audit') {
      args.snapshotAudit = argv[++index];
    } else if (arg === '--profile') {
      args.profile = argv[++index];
    } else if (arg === '--skip-commands') {
      args.skipCommands = true;
    } else {
      throw new Error(`Unknown phase-loop preflight argument: ${arg}`);
    }
  }
  return args;
}

function requiredPathInRepository(repoRoot, requestedPath, errors, options = {}) {
  const lexicalRepoRoot = path.resolve(repoRoot);
  const realRepoRoot = fs.realpathSync(repoRoot);
  const resolvedPath = path.resolve(lexicalRepoRoot, requestedPath);
  const relativePath = path.relative(lexicalRepoRoot, resolvedPath);
  if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    if (options.allowOutsideRepository === true) {
      return resolvedPath;
    }
    errors.push({
      code: 'required_file_outside_repository',
      path: requestedPath,
      message: `${requestedPath} must resolve inside the repository root.`
    });
    return null;
  }
  // Lexical containment is insufficient: readFileSync follows a symlink that
  // can point outside the repository. Resolve existing files before reading.
  if (fs.existsSync(resolvedPath)) {
    const realPath = fs.realpathSync(resolvedPath);
    const realRelativePath = path.relative(realRepoRoot, realPath);
    if (realRelativePath === '..' || realRelativePath.startsWith(`..${path.sep}`) || path.isAbsolute(realRelativePath)) {
      errors.push({
        code: 'required_file_outside_repository',
        path: requestedPath,
        message: `${requestedPath} must resolve inside the repository root.`
      });
      return null;
    }
  }
  return resolvedPath;
}

function readText(repoRoot, requestedPath, errors, options = {}) {
  const resolvedPath = requiredPathInRepository(repoRoot, requestedPath, errors, options);
  if (!resolvedPath) {
    return '';
  }
  try {
    return fs.readFileSync(resolvedPath, 'utf8');
  } catch (error) {
    errors.push({
      code: 'required_file_unreadable',
      path: requestedPath,
      message: `${requestedPath} must be readable: ${error.message}`
    });
    return '';
  }
}

function readJson(repoRoot, relativePath, errors) {
  const text = readText(repoRoot, relativePath, errors);
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    errors.push({
      code: 'json_parse_failed',
      path: relativePath,
      message: `${relativePath} must parse as JSON: ${error.message}`
    });
    return {};
  }
}

function sha256Text(text) {
  return `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;
}

function todoSnapshotAudit({ repoRoot, todoPath, todoText, breakdownPath, breakdownText, snapshotSource, snapshotAuditPath, controllerFingerprint, errors }) {
  if (!snapshotSource) {
    return null;
  }
  const sourcePath = path.resolve(snapshotSource);
  let sourceText;
  try {
    sourceText = fs.readFileSync(sourcePath, 'utf8');
  } catch (error) {
    errors.push({
      code: 'todo_snapshot_source_unreadable',
      path: snapshotSource,
      message: `TODO snapshot source must be readable: ${error.message}`
    });
    return null;
  }
  const sourceSha256 = sha256Text(sourceText);
  const snapshotSha256 = sha256Text(todoText);
  const breakdownSha256 = breakdownText === null ? null : sha256Text(breakdownText);
  const queueCas = sha256Text(`${snapshotSha256}\n${breakdownSha256 ?? 'missing'}`);
  let generation = 0;
  let mutation = null;
  if (sourceSha256 !== snapshotSha256) {
    let audit = null;
    try {
      audit = snapshotAuditPath ? JSON.parse(fs.readFileSync(path.resolve(snapshotAuditPath), 'utf8')) : null;
    } catch {
      audit = null;
    }
    const validMutationAudit = audit
      && audit.schema_version === 1
      && audit.source_path === sourcePath
      && audit.source_sha256 === sourceSha256
      && audit.source_base_sha256 === sourceSha256
      && audit.snapshot_path === path.resolve(repoRoot, todoPath)
      && audit.snapshot_sha256 === snapshotSha256
      && audit.queue_cas === queueCas
      && (!controllerFingerprint || audit.controller_source_fingerprint === controllerFingerprint)
      && Number.isInteger(audit.generation)
      && audit.generation > 0
      && audit.mutation?.kind === 'completed_todo_removal'
      && typeof audit.mutation.previous_snapshot_sha256 === 'string';
    if (!validMutationAudit) {
      errors.push({
        code: 'todo_snapshot_mutation_audit_missing',
        path: todoPath,
        source_path: sourcePath,
        snapshot_audit_path: snapshotAuditPath ?? null,
        source_sha256: sourceSha256,
        snapshot_sha256: snapshotSha256,
        message: 'A workspace TODO snapshot differs from its source without a matching controller-owned completion mutation audit.'
      });
    } else {
      generation = audit.generation;
      mutation = audit.mutation;
    }
  }
  return {
    schema_version: 1,
    source_path: sourcePath,
    snapshot_path: path.resolve(repoRoot, todoPath),
    source_base_sha256: sourceSha256,
    source_sha256: sourceSha256,
    snapshot_sha256: snapshotSha256,
    breakdown_path: path.resolve(repoRoot, breakdownPath),
    breakdown_sha256: breakdownSha256,
    queue_cas: queueCas,
    controller_source_fingerprint: controllerFingerprint ?? null,
    generation,
    ...(mutation ? { mutation } : {})
  };
}

function nextNonWhitespace(text, index) {
  let cursor = index;
  while (/\s/u.test(text[cursor] ?? '')) {
    cursor += 1;
  }
  return cursor;
}

function readJsonString(text, start) {
  let cursor = start + 1;
  let value = '';
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '\\') {
      value += char;
      cursor += 1;
      if (cursor < text.length) {
        value += text[cursor];
        cursor += 1;
      }
      continue;
    }
    if (char === '"') {
      try {
        return { value: JSON.parse(text.slice(start, cursor + 1)), end: cursor + 1 };
      } catch {
        return { value, end: cursor + 1 };
      }
    }
    value += char;
    cursor += 1;
  }
  return null;
}

export function duplicateJsonKeys(jsonText, relativePath = '<json>') {
  const duplicates = [];
  const stack = [];
  let cursor = 0;

  while (cursor < jsonText.length) {
    const char = jsonText[cursor];
    if (char === '"') {
      const parsed = readJsonString(jsonText, cursor);
      if (!parsed) {
        return duplicates;
      }
      const frame = stack.at(-1);
      const lookahead = nextNonWhitespace(jsonText, parsed.end);
      if (frame?.kind === 'object' && frame.expectingKey && jsonText[lookahead] === ':') {
        const key = parsed.value;
        if (frame.seen.has(key)) {
          duplicates.push({
            code: 'json_duplicate_key',
            path: relativePath,
            key,
            object_path: frame.path.length > 0 ? frame.path.join('.') : '<root>',
            message: `${relativePath} must not define duplicate JSON key ${key} at ${frame.path.length > 0 ? frame.path.join('.') : '<root>'}.`
          });
        }
        frame.seen.add(key);
        frame.pendingKey = key;
        frame.expectingKey = false;
      }
      cursor = parsed.end;
      continue;
    }
    if (char === '{') {
      const parent = stack.at(-1);
      const inheritedPath = parent?.pendingKey ? [...parent.path, parent.pendingKey] : parent?.path ?? [];
      stack.push({
        kind: 'object',
        seen: new Set(),
        path: inheritedPath,
        pendingKey: '',
        expectingKey: true
      });
    } else if (char === '[') {
      const parent = stack.at(-1);
      const inheritedPath = parent?.pendingKey ? [...parent.path, parent.pendingKey] : parent?.path ?? [];
      stack.push({ kind: 'array', path: inheritedPath, pendingKey: '' });
    } else if (char === '}' || char === ']') {
      stack.pop();
      const parent = stack.at(-1);
      if (parent?.kind === 'object') {
        parent.pendingKey = '';
      }
    } else if (char === ',') {
      const frame = stack.at(-1);
      if (frame?.kind === 'object') {
        frame.pendingKey = '';
        frame.expectingKey = true;
      }
    }
    cursor += 1;
  }
  return duplicates;
}

function git(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function gitDirtyFiles(repoRoot) {
  const output = git(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const body = line.slice(2).trimStart();
      return body.includes(' -> ') ? body.split(' -> ').at(-1) : body;
    })
    .filter((file) => !file.startsWith('.brownie/'))
    .filter((file) => !file.startsWith('crates/brownie-runtime/.brownie/'))
    .sort();
}

function uncheckedTodoBlocks(todoText) {
  const starts = [];
  const pattern = /^(?:[-*]|\d+[.)])\s+\[\s\]\s+/gmu;
  let match;
  while ((match = pattern.exec(todoText)) !== null) {
    starts.push(match.index);
  }
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : todoText.length;
    return todoText.slice(start, end).trimEnd();
  });
}

function completedTodoIds(todoText) {
  const ids = new Set();
  const pattern = /^(?:[-*]|\d+[.)])\s+\[x\]\s+([A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*):/gmu;
  let match;
  while ((match = pattern.exec(todoText)) !== null) {
    ids.add(match[1]);
  }
  return ids;
}

function validateCompletedParentPendingChildren(todoText, errors, todoState = null) {
  const checked = completedTodoIds(todoText);
  if (checked.size === 0) return;
  const supersededIds = todoState?.supersededIds instanceof Set
    ? todoState.supersededIds
    : new Set();
  const childrenByParent = todoState?.childrenByParent instanceof Map
    ? todoState.childrenByParent
    : new Map();
  for (const block of uncheckedTodoBlocks(todoText)) {
    const firstLine = block.split('\n')[0] ?? '';
    const child = /^(?:[-*]|\d+[.)])\s+\[\s\]\s+([A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*):/u.exec(firstLine)?.[1];
    const parent = /^\s*Source TODO:\s*([A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*)\.?\s*$/mu.exec(block)?.[1];
    if (!child || !parent || !checked.has(parent)) continue;
    // A checked parent normally closes every derived child.  The sole
    // exception is a durable, exact replan record: it represents a
    // superseded parent rather than a completed one, and it must name this
    // specific live child.  Do not allow a broad parent-only waiver.
    if (supersededIds.has(parent) && childrenByParent.get(parent)?.has(child)) {
      continue;
    }
    errors.push({
      code: 'completed_parent_pending_child',
      parent_todo: parent,
      child_todo: child,
      message: 'An unchecked child references a completed parent TODO. Record an auditable rebaseline that closes or supersedes the child before the phase loop can claim work.'
    });
  }
}

function hasImplementableTodo(todoText) {
  return uncheckedTodoBlocks(todoText).some((block) => {
    const lower = block.toLowerCase();
    const firstLine = block.split('\n')[0] ?? '';
    if (firstLine.includes('TODO-decompose-blocked-queue-')) {
      return true;
    }
    if (lower.includes('route: implementation') || lower.includes('route: documentation') || lower.includes('route: todo-decomposition')) {
      return true;
    }
    if (/\b(?:patch|create) only\b/iu.test(block)) {
      return true;
    }
    return false;
  });
}

function runCommand(repoRoot, command, args) {
  const completed = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return {
    command: [command, ...args].join(' '),
    exit_code: completed.status ?? 1,
    stdout_tail: (completed.stdout ?? '').slice(-1200),
    stderr_tail: (completed.stderr ?? '').slice(-1200)
  };
}

function validateReleaseEvidence(repoRoot, errors) {
  for (const relativePath of releaseJsonFiles) {
    const text = readText(repoRoot, relativePath, errors);
    for (const duplicate of duplicateJsonKeys(text, relativePath)) {
      errors.push(duplicate);
    }
  }

  const contract = readJson(repoRoot, 'docs/architecture/runtime-release-contract.json', errors);
  const auditText = readText(repoRoot, 'docs/architecture/runtime-release-readiness-audit.json', errors);
  const audit = readJson(repoRoot, 'docs/architecture/runtime-release-readiness-audit.json', errors);
  const expectedHash = sha256Text(auditText);
  const actualHash = contract?.commit_trace?.readiness_audit_content_sha256;
  if (actualHash !== expectedHash) {
    errors.push({
      code: 'readiness_audit_hash_mismatch',
      path: 'docs/architecture/runtime-release-contract.json',
      expected: expectedHash,
      actual: actualHash ?? null,
      message: 'Release Contract commit_trace.readiness_audit_content_sha256 must match the current readiness audit file hash.'
    });
  }

  if (typeof audit?.audited_main_commit === 'string') {
    const normalized = audit.audited_main_commit.trim().toLowerCase();
    if (!/^[a-f0-9]{40}$/u.test(normalized)) {
      errors.push({
        code: 'readiness_audit_main_commit_not_bound',
        path: 'docs/architecture/runtime-release-readiness-audit.json',
        actual: audit.audited_main_commit,
        message: 'Readiness Audit audited_main_commit must be a concrete 40-character commit SHA, not a placeholder.'
      });
    }
  }

  try {
    const auditedCommit = typeof audit?.audited_main_commit === 'string' ? audit.audited_main_commit.trim() : '';
    if (/^[a-f0-9]{40}$/u.test(auditedCommit)) {
      const mergeBase = git(repoRoot, ['merge-base', auditedCommit, 'HEAD']);
      if (mergeBase !== auditedCommit) {
        errors.push({
          code: 'readiness_audit_main_commit_unreachable',
          path: 'docs/architecture/runtime-release-readiness-audit.json',
          actual: auditedCommit,
          message: 'Readiness Audit audited_main_commit must be a reachable ancestor of HEAD. Exact HEAD matching is intentionally not required because PR merge commits advance main after the audited evidence is generated.'
        });
      }
    }
  } catch {
    // Fixture repos may not contain the audited commit. The concrete SHA check
    // above still prevents placeholders such as "current-main"; real phase-loop
    // workspaces with full history get the ancestry check.
  }
}

function hasPendingCompletionClaim(claimPath) {
  if (!claimPath) {
    return false;
  }
  try {
    const claim = JSON.parse(fs.readFileSync(path.resolve(claimPath), 'utf8'));
    return claim?.status === 'completed'
      && (claim.completion_cleanup_pending === true || claim.completion_pr_pending === true);
  } catch {
    return false;
  }
}

function validateDirtyDelivery(repoRoot, todoText, errors, options = {}) {
  const dirtyFiles = gitDirtyFiles(repoRoot);
  if (dirtyFiles.length === 0) {
    return;
  }
  if (!hasImplementableTodo(todoText)) {
    if (options.allowPendingCompletionRecovery === true && hasPendingCompletionClaim(options.claimPath)) {
      return;
    }
    errors.push({
      code: 'dirty_delivery_required',
      dirty_files: dirtyFiles,
      message: 'The workspace has uncommitted product changes but no implementable TODO remains; phase-loop must stop for commit/PR/review/merge instead of treating owner/release blockers as completion.'
    });
  }
}

function todoId(block) {
  return String(block ?? '').split('\n')[0]
    .trim()
    .replace(/^(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+/u, '')
    .split(':')[0]
    ?.trim() ?? '';
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function readJsonInside(root, candidate) {
  if (!isPathInside(root, candidate) || !fs.existsSync(candidate)) return null;
  try {
    const realRoot = fs.realpathSync(root);
    const realCandidate = fs.realpathSync(candidate);
    if (!isPathInside(realRoot, realCandidate)) return null;
    const value = JSON.parse(fs.readFileSync(realCandidate, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function resolveRepositoryArtifactPath(repoRoot, candidate) {
  return typeof candidate === 'string' && candidate ? path.resolve(repoRoot, candidate) : null;
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function validClaimTarget(target) {
  if (typeof target !== 'string' || !target || path.posix.isAbsolute(target)) return false;
  const parts = target.split('/');
  return !parts.includes('..') && !parts.includes('.') && !parts.includes('');
}

function phaseLoopPayload(value) {
  if (value?.run && typeof value.run === 'object') return value.run;
  if (value?.resume && typeof value.resume === 'object') return value.resume;
  return value && typeof value === 'object' ? value : {};
}

function payloadValue(payload, automation, field) {
  return payload?.[field] ?? automation?.[field] ?? null;
}

function activeClaimEvidencePaths({ repoRoot, stateRoot, claim }) {
  const candidates = new Set();
  const currentEvidencePath = resolveRepositoryArtifactPath(repoRoot, claim.terminal_failure_execution_evidence_path);
  if (currentEvidencePath && isPathInside(stateRoot, currentEvidencePath)) {
    candidates.add(currentEvidencePath);
  }

  // A continuation updates the mutable claim pointer to its latest execution
  // evidence.  Each earlier successful proposal is still independently bound
  // to the same immutable claim, queue, runtime admission, and stdout. Scan
  // only the state-root run evidence so a later continuation cannot strand a
  // previously materialized target behind a newer, unrelated target.
  const runsDirectory = path.join(stateRoot, 'runs');
  if (!isPathInside(stateRoot, runsDirectory)) return [...candidates].sort();
  try {
    for (const entry of fs.readdirSync(runsDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[A-Za-z0-9_.-]+\.execution-evidence\.json$/u.test(entry.name)) continue;
      candidates.add(path.join(runsDirectory, entry.name));
    }
  } catch {
    // The claim-pointer candidate remains sufficient for a one-run claim.
  }
  return [...candidates].sort();
}

function verifiedActiveClaimMaterialization({
  repoRoot,
  stateRoot,
  evidencePath,
  claimId,
  selectedTodoId,
  selectedTodoSha256,
  queueGeneration,
  queueFingerprint,
  selectedTargets
}) {
  const evidence = readJsonInside(stateRoot, evidencePath);
  const materializationRunStamp = typeof evidence?.run_stamp === 'string' ? evidence.run_stamp : '';
  if (!evidence
    || !materializationRunStamp
    || evidence.claim_id !== claimId
    || evidence.runtime_claim_id !== claimId
    || evidence.claim_matches !== true
    || evidence.selected_todo_id !== selectedTodoId
    || evidence.selected_todo_sha256 !== selectedTodoSha256
    || evidence.task_execution_confirmed !== true
    || !Array.isArray(evidence.target_files)) {
    return null;
  }

  const admission = readJsonInside(stateRoot, path.join(stateRoot, 'runs', `${materializationRunStamp}.runtime-admission.json`));
  if (!admission
    || admission.status !== 'admitted'
    || admission.claim_id !== claimId
    || admission.selected_todo_id !== selectedTodoId
    || admission.selected_todo_sha256 !== selectedTodoSha256
    || String(admission.queue_generation ?? '') !== String(queueGeneration)
    || String(admission.queue_fingerprint ?? '') !== queueFingerprint) {
    return null;
  }

  const stdoutPath = resolveRepositoryArtifactPath(repoRoot, evidence.stdout_path);
  const stdout = stdoutPath ? readJsonInside(stateRoot, stdoutPath) : null;
  const payload = phaseLoopPayload(stdout);
  const automation = payload.automation && typeof payload.automation === 'object' ? payload.automation : {};
  const materializedTarget = typeof payload.objective_apply_path === 'string' ? payload.objective_apply_path : '';
  if (payloadValue(payload, automation, 'phase_loop_claim_id') !== claimId
    || payloadValue(payload, automation, 'phase_loop_selected_todo_sha256') !== selectedTodoSha256
    || String(payloadValue(payload, automation, 'phase_loop_queue_generation') ?? '') !== String(queueGeneration)
    || String(payloadValue(payload, automation, 'phase_loop_queue_fingerprint') ?? '') !== queueFingerprint
    || payload.objective_apply_applied !== true
    || !validClaimTarget(materializedTarget)
    || !selectedTargets.includes(materializedTarget)
    || !evidence.target_files.includes(materializedTarget)
    || payload.status !== 'objective_proposal_applied') {
    return null;
  }

  return { materialization_run_stamp: materializationRunStamp, materialized_target: materializedTarget };
}

function activeClaimMaterializedPlaceholder({ repoRoot, stateRoot, claimPath, stage, todoText }) {
  // This narrowly proves materialization by the current admitted claim. It is
  // deliberately unavailable to generic/manual preflight calls and to fresh
  // claims, so a future leaf cannot inherit an unproven dirty placeholder.
  // A verified proposal can leave a bounded placeholder in its declared
  // target while the same claim reaches pre-completion verification.  Treat
  // that path as claim-controlled too; otherwise the controller proves the
  // placeholder belongs to the claim at resume admission, then rejects the
  // identical evidence before it can verify or repair the proposal.
  if (!['pre-claim-boundary', 'pre-claim', 'pre-completion'].includes(stage)) return null;
  if (!stateRoot || !claimPath || !isPathInside(stateRoot, claimPath)) return null;

  const claim = readJsonInside(stateRoot, claimPath);
  if (!claim || claim.status !== 'in_progress') return null;
  const claimId = typeof claim.claim_id === 'string' ? claim.claim_id : '';
  const selectedTodo = typeof claim.selected_todo === 'string' ? claim.selected_todo : '';
  // `write_todo_claim` updates this stamp for every continuation. It records
  // the latest attempt, not the immutable run that materialized a target.
  const claimRunStamp = typeof claim.run_stamp === 'string' ? claim.run_stamp : '';
  const queueFingerprint = typeof claim.queue_fingerprint === 'string' ? claim.queue_fingerprint : '';
  if (!claimId || !selectedTodo || !claimRunStamp || !queueFingerprint || claim.queue_generation == null) return null;
  // The claim must still identify one exact unchecked queue entry.  A
  // substring match would let a stale claim borrow authority from prose or a
  // modified successor leaf that merely repeats its text.
  // The claim selector uses the decomposition guard's parser, which ends a
  // block at either an unchecked or checked checkbox entry.  Reuse it here so
  // exact claim matching cannot reject a valid selected block merely because
  // a completed entry immediately follows it in the queue.
  if (!claimSelectorTodoBlocks(todoText).includes(selectedTodo)) return null;

  const selectedFirstLine = selectedTodo.split('\n')[0] ?? '';
  const selectedTargets = boundedScopeEntries(selectedFirstLine)
    .map((entry) => entry.path)
    .filter((entry) => validClaimTarget(entry));
  if (selectedTargets.length === 0) return null;

  const queue = readJsonInside(stateRoot, path.join(stateRoot, 'todo-claims', 'todo-queue-state.json'));
  if (!queue
    || String(queue.generation ?? '') !== String(claim.queue_generation)
    || String(queue.fingerprint ?? '') !== queueFingerprint) {
    return null;
  }

  const selectedTodoSha256 = sha256Hex(selectedTodo);
  const materializationsByTarget = new Map();
  for (const evidencePath of activeClaimEvidencePaths({ repoRoot, stateRoot, claim })) {
    const materialization = verifiedActiveClaimMaterialization({
      repoRoot,
      stateRoot,
      evidencePath,
      claimId,
      selectedTodoId: todoId(selectedTodo),
      selectedTodoSha256,
      queueGeneration: claim.queue_generation,
      queueFingerprint,
      selectedTargets
    });
    if (!materialization) continue;
    const existing = materializationsByTarget.get(materialization.materialized_target);
    if (!existing || materialization.materialization_run_stamp < existing.materialization_run_stamp) {
      materializationsByTarget.set(materialization.materialized_target, materialization);
    }
  }
  const materializations = [...materializationsByTarget.values()]
    .sort((left, right) => left.materialized_target.localeCompare(right.materialized_target)
      || left.materialization_run_stamp.localeCompare(right.materialization_run_stamp));
  if (materializations.length === 0) return null;

  return {
    claim_id: claimId,
    claim_run_stamp: claimRunStamp,
    selected_todo: selectedTodo,
    selected_todo_id: todoId(selectedTodo),
    selected_todo_sha256: selectedTodoSha256,
    selected_todo_first_line: selectedFirstLine,
    queue_generation: claim.queue_generation,
    queue_fingerprint: queueFingerprint,
    materializations
  };
}

function validateDirtyTargetPlaceholders(repoRoot, todoText, errors, warnings, options = {}) {
  const dirty = new Set(gitDirtyFiles(repoRoot));
  const result = {
    active_materialization: null,
    admitted_active_claim_targets: []
  };
  if (dirty.size === 0) return result;
  const warnedActiveClaimTargets = new Set();
  const warnedSharedClaimTargets = new Set();
  const activeMaterialization = activeClaimMaterializedPlaceholder({
    repoRoot,
    stateRoot: options.stateRoot,
    claimPath: options.claimPath,
    stage: options.stage,
    todoText
  });
  const rebaselineRecords = readContractRebaselineRecords(repoRoot);
  for (const block of uncheckedTodoBlocks(todoText)) {
    const firstLine = block.split('\n')[0] ?? '';
    const targets = boundedScopeEntries(firstLine)
      .map((entry) => entry.path)
      .filter((entry) => validClaimTarget(entry));
    for (const target of targets) {
      if (!dirty.has(target)) continue;
      const absoluteTarget = path.join(repoRoot, target);
      let content = '';
      try { content = fs.readFileSync(absoluteTarget, 'utf8').trim(); } catch { continue; }
      if (content.length > 160 || !/brownie bounded (?:patch|create)-only proposal\.?/iu.test(content)) continue;
      const sha256 = crypto.createHash('sha256').update(content).digest('hex');
      const rebaselined = rebaselineRecords.find((record) => matchesMaterializedTargetRebaseline(record, {
        todoId: todoId(block),
        currentContract: protectedContract(block),
        targetPath: target,
        targetSha256: sha256
      })) ?? matchesMaterializedTargetRebaselineChain(rebaselineRecords, {
        todoId: todoId(block),
        currentContract: protectedContract(block),
        targetPath: target,
        targetSha256: sha256
      });
      if (rebaselined) {
        warnings.push({
          code: 'rebaselined_dirty_target_placeholder',
          todo_id: todoId(block),
          target,
          contract_rebaseline_run_stamp: rebaselined.cause_run.run_stamp,
          message: 'A materialized Create-only target is admitted as Patch-only only through an exact target-hash-bound rebaseline receipt.'
        });
        continue;
      }
      const targetMaterialization = activeMaterialization?.materializations
        ?.find((materialization) => materialization.materialized_target === target) ?? null;
      const materializedTarget = targetMaterialization !== null;
      // `uncheckedTodoBlocks` intentionally retains intervening completed
      // entries, whereas claimSelectorTodoBlocks terminates at either checkbox
      // state. The selector proof above establishes the full exact claim;
      // match the unchecked view by the same unchecked first line and ID.
      const blockIsSelectedClaim = (
        firstLine === activeMaterialization?.selected_todo_first_line
        && todoId(block) === activeMaterialization?.selected_todo_id
      );
      if (materializedTarget && blockIsSelectedClaim) {
        result.active_materialization = activeMaterialization;
        result.admitted_active_claim_targets.push({
          target,
          sha256: `sha256:${sha256}`,
          materialization_run_stamp: targetMaterialization.materialization_run_stamp
        });
        const warningKey = `${activeMaterialization.claim_id}\u0000${target}`;
        if (!warnedActiveClaimTargets.has(warningKey)) {
          warnedActiveClaimTargets.add(warningKey);
          warnings.push({
            code: 'active_claim_owned_dirty_target_placeholder',
            claim_id: activeMaterialization.claim_id,
            run_stamp: targetMaterialization.materialization_run_stamp,
            target,
            sha256: `sha256:${sha256}`,
            message: 'A dirty bounded-proposal placeholder is attributable to the exact active Runtime claim and is admitted only for that claim resume.'
          });
        }
        continue;
      }
      if (materializedTarget) {
        // A sibling can name the same path, but it has not inherited the
        // active claim's authority. Defer this one dirty target only while
        // that exact claim is active; the normal fail-closed check resumes as
        // soon as the claim settles or its evidence no longer matches.
        const warningKey = `${activeMaterialization.claim_id}\u0000${todoId(block)}\u0000${target}`;
        if (!warnedSharedClaimTargets.has(warningKey)) {
          warnedSharedClaimTargets.add(warningKey);
          warnings.push({
            code: 'active_claim_shared_dirty_target_deferred',
            claim_id: activeMaterialization.claim_id,
            materialization_run_stamp: targetMaterialization.materialization_run_stamp,
            selected_todo_id: activeMaterialization.selected_todo_id,
            todo_id: todoId(block),
            target,
            sha256: `sha256:${sha256}`,
            message: 'A later TODO shares a dirty target materialized by the exact active claim; it is deferred without inheriting resume authority.'
          });
        }
        continue;
      }
      errors.push({
        code: 'contract_unsatisfiable_dirty_scope',
        todo: firstLine.trim(),
        target,
        sha256: `sha256:${sha256}`,
        message: 'Selected TODO targets a dirty bounded-proposal placeholder. Snapshot and rebaseline the target set before any claim or retry.'
      });
    }
  }
  result.admitted_active_claim_targets.sort((left, right) => left.target.localeCompare(right.target)
    || left.materialization_run_stamp.localeCompare(right.materialization_run_stamp));
  return result;
}

function validateRequiredCommands(repoRoot, todoPath, breakdownPath, controlPlaneRoot, profile, errors) {
  const controlScripts = path.join(controlPlaneRoot, 'scripts');
  const absoluteTodoPath = path.resolve(repoRoot, todoPath);
  const absoluteBreakdownPath = path.resolve(repoRoot, breakdownPath);
  const fixtureProfile = profile === 'claim-smoke-fixture';
  const policyRoot = fixtureProfile ? controlPlaneRoot : repoRoot;
  const queueIntegrityCommand = ['node', [path.join(controlScripts, 'phase-loop-todo-queue-integrity.mjs'), '--repo', repoRoot, '--todo', absoluteTodoPath, '--breakdown', absoluteBreakdownPath]];
  const commands = fixtureProfile
    ? [queueIntegrityCommand]
    : [
      ['node', [path.join(controlScripts, 'guard-todo-decomposition.mjs'), '--repo', policyRoot, '--todo', absoluteTodoPath, '--breakdown', absoluteBreakdownPath]],
      queueIntegrityCommand,
      ['node', [path.join(controlScripts, 'guard-release-contract.mjs'), '--repo', policyRoot]],
      ['node', [path.join(controlScripts, 'guard-runtime-release-readiness.mjs'), '--repo', policyRoot]]
    ];
  const results = [];
  for (const [command, args] of commands) {
    const commandRoot = args.includes(path.join(controlScripts, 'phase-loop-todo-queue-integrity.mjs')) ? repoRoot : policyRoot;
    const result = runCommand(commandRoot, command, args);
    results.push(result);
    if (result.exit_code !== 0) {
      errors.push({
        code: 'phase_loop_preflight_command_failed',
        command: result.command,
        stdout_tail: result.stdout_tail,
        stderr_tail: result.stderr_tail,
        message: `Phase-loop preflight command failed: ${result.command}`
      });
      break;
    }
  }
  return results;
}

export function validatePhaseLoopPreflight(options = {}) {
  const repoRoot = path.resolve(options.repo ?? defaultRepoRoot);
  const controlPlaneRoot = path.resolve(options.controlPlaneRoot ?? repoRoot);
  const profile = options.profile ?? 'production';
  const errors = [];
  const warnings = [];
  const executionContext = bindExecutionContext({
    workspaceRoot: repoRoot,
    controllerRoot: controlPlaneRoot,
    stateRoot: options.stateRoot,
    cliRoot: options.cliRoot,
    runtimeRoot: options.runtimeRoot,
    todoPath: path.resolve(repoRoot, options.todo ?? '.brownie/todo.md'),
    baseCommit: options.baseCommit,
    expectedActor: options.expectedActor,
    allowExternalController: profile === 'claim-smoke-fixture',
    allowExternalState: profile === 'claim-smoke-fixture',
    allowExternalTodo: profile === 'claim-smoke-fixture',
    auditPath: options.contextAudit
  });
  errors.push(...executionContext.errors);
  if (!['production', 'claim-smoke-fixture'].includes(profile)) {
    errors.push({
      code: 'phase_loop_preflight_profile_unknown',
      profile,
      message: `Unknown phase-loop preflight profile: ${profile}`
    });
  }
  if (profile === 'claim-smoke-fixture' && process.env.PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY !== '1') {
    errors.push({
      code: 'phase_loop_preflight_fixture_profile_forbidden',
      profile,
      message: 'The claim-smoke fixture profile requires the explicit test-only PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY=1 marker.'
    });
  }
  if (profile !== 'claim-smoke-fixture' && process.env.PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY === '1') {
    errors.push({
      code: 'phase_loop_preflight_fixture_marker_forbidden',
      profile,
      message: 'The PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY=1 marker is permitted only with the claim-smoke-fixture profile.'
    });
  }
  const todoPath = options.todo ?? '.brownie/todo.md';
  const fixtureProfile = profile === 'claim-smoke-fixture';
  const stateRoot = path.resolve(repoRoot, options.stateRoot ?? path.join(repoRoot, '.brownie/private/phase-loop'));
  const claimPath = path.resolve(repoRoot, options.claim ?? '.brownie/private/phase-loop/todo-claims/current.json');
  const fixturePathOptions = fixtureProfile ? { allowOutsideRepository: true } : {};
  const todoText = readText(repoRoot, todoPath, errors, fixturePathOptions);
  const breakdownPath = options.breakdown ?? '.brownie/todo-breakdown.md';
  const breakdownText = options.snapshotSource
    ? readText(repoRoot, breakdownPath, errors, fixturePathOptions)
    : null;
  const snapshotAudit = errors.some((error) => error.code === 'required_file_outside_repository')
    ? null
    : todoSnapshotAudit({
      repoRoot,
      todoPath,
      todoText,
      breakdownPath,
      breakdownText,
      snapshotSource: options.snapshotSource,
      snapshotAuditPath: options.snapshotAudit,
      controllerFingerprint: options.controllerFingerprint,
      errors
    });
  validateReleaseEvidence(profile === 'claim-smoke-fixture' ? controlPlaneRoot : repoRoot, errors);
  validateDirtyDelivery(repoRoot, todoText, errors, {
    allowPendingCompletionRecovery: fixtureProfile,
    claimPath: options.claim
  });
  const dirtyTargetValidation = validateDirtyTargetPlaceholders(repoRoot, todoText, errors, warnings, {
    stateRoot,
    claimPath,
    stage: options.stage ?? 'general'
  });
  // Claim-smoke fixtures intentionally model intermediate controller-owned
  // completion mutations. Production queues must never carry that shape.
  if (!fixtureProfile) {
    const replanState = resolveTodoState({
      todoText,
      replanRecords: readAllTodoReplanRecords(repoRoot, {
        breakdownPath: path.resolve(repoRoot, breakdownPath)
      })
    });
    validateCompletedParentPendingChildren(todoText, errors, replanState);
  }
  const commandResults = options.skipCommands ? [] : validateRequiredCommands(repoRoot, todoPath, breakdownPath, controlPlaneRoot, profile, errors);
  // A pre-claim boundary can authorize preservation of an ownerless active
  // claim only when this invocation just re-verified the exact dirty
  // placeholder(s) it owns.  This is deliberately narrower than the warning:
  // generic preflight and later leafs never receive a resume admission.
  const activeClaimResumeAdmission = (
    (options.stage ?? 'general') === 'pre-claim-boundary'
    && errors.length === 0
    && dirtyTargetValidation.active_materialization !== null
    && dirtyTargetValidation.admitted_active_claim_targets.length > 0
  ) ? {
      schema_version: 1,
      kind: 'phase_loop_active_claim_resume_admission',
      claim_id: dirtyTargetValidation.active_materialization.claim_id,
      claim_run_stamp: dirtyTargetValidation.active_materialization.claim_run_stamp,
      selected_todo_id: dirtyTargetValidation.active_materialization.selected_todo_id,
      selected_todo_sha256: dirtyTargetValidation.active_materialization.selected_todo_sha256,
      queue_generation: dirtyTargetValidation.active_materialization.queue_generation,
      queue_fingerprint: dirtyTargetValidation.active_materialization.queue_fingerprint,
      admitted_targets: dirtyTargetValidation.admitted_active_claim_targets,
      materializations: dirtyTargetValidation.active_materialization.materializations
    } : null;

  return {
    schema_version: 1,
    valid: errors.length === 0,
    stage: options.stage ?? 'general',
    profile,
    errors,
    warnings,
    ...(snapshotAudit ? { snapshot_audit: snapshotAudit } : {}),
    ...(activeClaimResumeAdmission ? { active_claim_resume_admission: activeClaimResumeAdmission } : {}),
    execution_context: { ...executionContext.context, errors: executionContext.errors },
    command_results: commandResults
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = validatePhaseLoopPreflight(args);
    const output = JSON.stringify(result, null, 2);
    if (result.valid) {
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
        code: 'phase_loop_preflight_exception',
        message: error?.message ?? String(error)
      }]
    }, null, 2));
    process.exit(1);
  }
}
