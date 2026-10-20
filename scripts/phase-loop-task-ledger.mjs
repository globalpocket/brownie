#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readClaimSnapshot } from './phase-loop-claim-lifecycle.mjs';

export const TASK_STATES = new Set(['queued', 'claimed', 'running', 'completed', 'blocked', 'replanned', 'failed']);
const TERMINAL_STATES = new Set(['completed', 'blocked', 'replanned', 'failed']);
const ALLOWED = new Map([
  ['queued', new Set(['claimed', 'blocked', 'replanned'])],
  ['claimed', new Set(['running', 'blocked', 'replanned', 'failed'])],
  ['running', new Set(['completed', 'blocked', 'replanned', 'failed'])]
]);

export function taskLedgerPath(repoRoot) {
  return path.join(repoRoot, '.brownie/private/phase-loop/task-ledger.jsonl');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function isTerminalTaskState(state) {
  return TERMINAL_STATES.has(state);
}

export function readTaskLedger(repoRoot) {
  const file = taskLedgerPath(repoRoot);
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      try {
        const record = JSON.parse(line);
        // A replacement set is projected only when its one-line journal
        // record is complete. A torn append therefore exposes no terminal
        // parent without its children.
        if (record?.kind === 'replan_transaction') {
          return Array.isArray(record.events) && record.events.length > 1 && record.events.every((event) => event?.task_id && TASK_STATES.has(event?.to_state))
            ? record.events : [];
        }
        if (record?.kind === 'terminal_failure_transaction') {
          return Array.isArray(record.events) && record.events.length > 0 && record.events.every((event) => event?.task_id && TASK_STATES.has(event?.to_state))
            ? record.events : [];
        }
        if (record?.kind === 'unclaimed_trajectory') return [];
        return [record];
      } catch { return []; }
    });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export function taskProjection(events) {
  const tasks = new Map();
  for (const event of events) {
    if (!event || typeof event.task_id !== 'string' || !TASK_STATES.has(event.to_state)) continue;
    const previous = tasks.get(event.task_id);
    if (!previous || previous.sequence < event.sequence) tasks.set(event.task_id, event);
  }
  return tasks;
}

export function validateTransition({ previous, toState, to_state: snakeCaseToState, reason, replaces = [] }) {
  toState ??= snakeCaseToState;
  if (!TASK_STATES.has(toState)) return { ok: false, code: 'unknown_task_state' };
  if (!previous) {
    return toState === 'queued'
      ? { ok: true }
      : { ok: false, code: 'task_must_start_queued' };
  }
  if (isTerminalTaskState(previous.to_state)) return { ok: false, code: 'terminal_task_cannot_transition' };
  if (!ALLOWED.get(previous.to_state)?.has(toState)) return { ok: false, code: 'invalid_task_transition' };
  if (toState === 'replanned' && (!reason || !Array.isArray(replaces) || replaces.length === 0)) {
    return { ok: false, code: 'replan_requires_reason_and_children' };
  }
  if (toState === 'blocked' && !reason) return { ok: false, code: 'blocked_requires_reason' };
  return { ok: true };
}

export function appendTaskTransition(repoRoot, input) {
  let events;
  try {
    events = readTaskLedger(repoRoot);
  } catch (error) {
    return { ok: false, code: 'ledger_append_failed', error: error.message };
  }
  const current = taskProjection(events).get(input.task_id);
  const toState = input.to_state ?? input.toState;
  const verdict = validateTransition({ previous: current, toState, ...input });
  if (!verdict.ok) {
    const duplicate = input.claim_id != null && events.find((event) => (
      event?.task_id === input.task_id
      && event?.to_state === toState
      && event?.claim_id === input.claim_id
      && (event?.task_spec_sha256 ?? null) === (input.task_spec_sha256 ?? null)
      && (event?.reason ?? null) === (input.reason ?? null)
    ));
    if (duplicate) return { ok: true, code: 'duplicate_transition', event: duplicate };
    return verdict;
  }
  const event = {
    schema_version: 1,
    event_id: crypto.randomUUID(),
    task_id: input.task_id,
    from_state: current?.to_state ?? null,
    to_state: toState,
    sequence: (current?.sequence ?? 0) + 1,
    at: input.at ?? new Date().toISOString(),
    run_id: input.run_id ?? null,
    claim_id: input.claim_id ?? null,
    reason: input.reason ?? null,
    replaces: input.replaces ?? [],
    task_spec_sha256: input.task_spec_sha256 ?? null,
    parent_task_id: input.parent_task_id ?? current?.parent_task_id ?? null
  };
  const file = taskLedgerPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { ok: true, event };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value ?? null;
}

function semanticEqual(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function sameTaskIdSet(left, right) {
  return semanticEqual([...left].sort(), [...right].sort());
}

function replacementChildMatches(event, child, parentTaskId, runId) {
  return event?.task_id === child?.task_id
    && event?.from_state === null
    && event?.to_state === 'queued'
    && (event?.run_id ?? null) === (runId ?? null)
    && event?.claim_id === null
    && event?.reason === `replacement_for:${parentTaskId}`
    && Array.isArray(event?.replaces)
    && event.replaces.length === 0
    && (event?.task_spec_sha256 ?? null) === (child?.task_spec_sha256 ?? null)
    && semanticEqual(event?.patch_targets, child?.patch_targets)
    && semanticEqual(event?.verification_commands, child?.verification_commands)
    && semanticEqual(event?.route, child?.route)
    && event?.parent_task_id === parentTaskId;
}

function exactReplanEvents(events, parentEvent, children, parentTaskId, runId) {
  const childIds = children.map((child) => child?.task_id);
  if (!sameTaskIdSet(parentEvent?.replaces ?? [], childIds)) return null;
  const replacementEvents = events.filter((event) => (
    event?.parent_task_id === parentTaskId
    && event?.to_state === 'queued'
    && (event?.run_id ?? null) === (runId ?? null)
    && event?.claim_id === null
  ));
  if (replacementEvents.length !== children.length) return null;
  const matchedChildren = children.map((child) => replacementEvents.find((event) => replacementChildMatches(event, child, parentTaskId, runId)));
  if (matchedChildren.some((event) => !event)) return null;
  return [parentEvent, ...matchedChildren];
}

// Replanning is a single ledger commit: the original task becomes terminal
// only in the same append that introduces every replacement child.  The TODO
// markdown remains a compatibility projection during migration; consumers
// must not infer task state from it.
export function replanTaskWithChildren(repoRoot, { task_id, reason, children, run_id = null, claim_id = null, task_spec_sha256 = null, at }) {
  if (!Array.isArray(children) || children.length === 0) return { ok: false, code: 'replan_requires_reason_and_children' };
  let events;
  try {
    events = readTaskLedger(repoRoot);
  } catch (error) {
    return { ok: false, code: 'ledger_append_failed', error: error.message };
  }
  const projection = taskProjection(events);
  const childIds = children.map((child) => child?.task_id);
  const duplicateCandidates = events.filter((event) => (
    event?.task_id === task_id
    && event?.to_state === 'replanned'
    && (event?.run_id ?? null) === run_id
    && (event?.claim_id ?? null) === claim_id
    && (event?.task_spec_sha256 ?? null) === (task_spec_sha256 ?? null)
    && (event?.reason ?? null) === reason
  ));
  if (duplicateCandidates.length > 0) {
    const exact = duplicateCandidates.map((parentEvent) => exactReplanEvents(events, parentEvent, children, task_id, run_id)).find(Boolean);
    if (exact) return { ok: true, code: 'duplicate_replan', events: exact, duplicate: true };
    return {
      ok: false,
      code: 'replan_duplicate_mismatch',
      task_id,
      reason: 'immutable_replan_parent_matches_but_replacement_children_differ'
    };
  }
  const parent = projection.get(task_id);
  if (new Set(childIds).size !== childIds.length || childIds.some((id) => !id)) return { ok: false, code: 'replan_children_must_have_unique_ids' };
  const parentVerdict = validateTransition({ previous: parent, toState: 'replanned', reason, replaces: childIds });
  if (!parentVerdict.ok) return parentVerdict;
  for (const child of children) {
    const gate = taskIsExecutable(child);
    if (!gate.ok) return { ok: false, code: 'replan_child_not_executable', task_id: child.task_id, missing: gate.missing };
    if (projection.has(child.task_id)) return { ok: false, code: 'replan_child_already_exists', task_id: child.task_id };
  }
  const timestamp = at ?? new Date().toISOString();
  const parentEvent = {
    schema_version: 1, event_id: crypto.randomUUID(), task_id, from_state: parent?.to_state ?? null,
    to_state: 'replanned', sequence: (parent?.sequence ?? 0) + 1, at: timestamp, run_id, claim_id,
    reason, replaces: childIds, task_spec_sha256
  };
  const childEvents = children.map((child) => ({
    schema_version: 1, event_id: crypto.randomUUID(), task_id: child.task_id, from_state: null,
    to_state: 'queued', sequence: 1, at: timestamp, run_id, claim_id: null, reason: `replacement_for:${task_id}`,
    replaces: [], task_spec_sha256: child.task_spec_sha256 ?? null,
    patch_targets: child.patch_targets, verification_commands: child.verification_commands, route: child.route,
    parent_task_id: task_id
  }));
  const file = taskLedgerPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // Keep the entire replacement set inside one journal record. A torn write
  // cannot become a parent-only replan because readTaskLedger ignores an
  // incomplete transaction rather than projecting its individual events.
  const transaction = {
    schema_version: 1,
    kind: 'replan_transaction',
    transaction_id: crypto.randomUUID(),
    events: [parentEvent, ...childEvents]
  };
  fs.appendFileSync(file, `${JSON.stringify(transaction)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { ok: true, events: [parentEvent, ...childEvents] };
}

function selectedTodoId(selectedTodo) {
  return String(selectedTodo ?? '').split('\n')[0].match(/^\s*(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+([^:\s]+)/u)?.[1] ?? '';
}

function terminalFailureRecoveryTaskId(selectedTodo, recoveryId) {
  const sourceTaskId = selectedTodoId(selectedTodo);
  return `${sourceTaskId || 'unknown-task'}@recovery-${recoveryId}`;
}

export function recordTerminalFailureRecovery(repoRoot, {
  selected_todo,
  claim_id = null,
  run_id = null,
  queue_generation = null,
  queue_fingerprint = null,
  provider_failure_fingerprint = null,
  retry_cap = 0,
  controller_fingerprint = null,
  recovery_id = null,
  claim_absent = false,
  execution_evidence = null,
  blocked_reason = 'terminal_runtime_failure',
  at
}) {
  if (typeof selected_todo !== 'string' || !selected_todo.trim()) {
    return { ok: false, code: 'terminal_failure_selected_todo_missing' };
  }
  const executionEvidence = typeof execution_evidence === 'string' ? readJson(execution_evidence) : execution_evidence;
  if (!executionEvidence || executionEvidence.kind !== 'phase_loop_terminal_failure_execution_evidence' || executionEvidence.task_execution_confirmed !== true) {
    return { ok: false, code: 'terminal_failure_execution_evidence_missing' };
  }
  if (executionEvidence.claim_id !== (claim_id ?? null) || executionEvidence.selected_todo_sha256 !== crypto.createHash('sha256').update(selected_todo).digest('hex')) {
    return { ok: false, code: 'terminal_failure_execution_evidence_mismatch' };
  }
  if (Number(retry_cap) === 0) {
    return { ok: false, code: 'terminal_failure_retry_cap_zero_requires_redelegation' };
  }
  let resolvedRecoveryId = recovery_id || crypto.createHash('sha256')
    .update(JSON.stringify({
      selected_todo,
      claim_id,
      run_id,
      queue_generation,
      queue_fingerprint,
      provider_failure_fingerprint,
      retry_cap,
      controller_fingerprint,
      blocked_reason
    }))
    .digest('hex')
    .slice(0, 24);
  let events;
  try {
    events = readTaskLedger(repoRoot);
  } catch (error) {
    return { ok: false, code: 'ledger_append_failed', error: error.message };
  }
  const priorRecovery = events.find((event) => event?.recovery_id === resolvedRecoveryId && event?.to_state === 'failed');
  // A caller may replay a persisted recovery id after the controller has
  // rebaselined. Keep the old attempt immutable, but derive a new attempt for
  // the new controller identity instead of treating the rebaseline as a
  // duplicate forever.
  if (priorRecovery && (priorRecovery.controller_fingerprint ?? null) !== (controller_fingerprint ?? null)) {
    resolvedRecoveryId = crypto.createHash('sha256')
      .update(JSON.stringify({ recovery_id: resolvedRecoveryId, controller_fingerprint }))
      .digest('hex')
      .slice(0, 24);
  }
  const taskId = terminalFailureRecoveryTaskId(selected_todo, resolvedRecoveryId);
  const specHash = crypto.createHash('sha256').update(selected_todo).digest('hex');
  const targetScope = selected_todo.match(/\b(?:Patch|Create) only\b([^\n]*)/u)?.[1] ?? '';
  const targetFiles = [...targetScope.matchAll(/`([^`]+)`/gu)]
    .map((match) => match[1])
    .filter((value) => /[/.]/u.test(value));
  const verificationCommands = [...selected_todo.matchAll(/^\s*Verification:\s*run\s+`([^`]+)`/gmu)]
    .map((match) => match[1]);
  const parentTodoId = selected_todo.match(/^\s*(?:Source|Parent) TODO:\s*([^\s.]+)/mu)?.[1] ?? null;
  if (events.some((event) => event?.recovery_id === resolvedRecoveryId && event?.to_state === 'failed')) {
    return { ok: true, code: 'duplicate_terminal_failure_recovery', task_id: taskId, recovery_id: resolvedRecoveryId };
  }
  const projected = taskProjection(events);
  const current = projected.get(taskId);
  const timestamp = at ?? new Date().toISOString();
  const common = {
    schema_version: 1,
    task_id: taskId,
    run_id,
    claim_id: claim_id ?? null,
    task_spec_sha256: specHash,
    reason: 'trajectory_failed',
    blocked_reason,
    parent_todo_id: parentTodoId,
    recovery_id: resolvedRecoveryId,
    selected_todo,
    target_files: targetFiles,
    verification_commands: verificationCommands,
    queue_generation,
    queue_fingerprint,
    provider_failure_fingerprint,
    retry_cap: Number.isInteger(Number(retry_cap)) ? Number(retry_cap) : 0,
    controller_fingerprint,
    claim_absent: Boolean(claim_absent),
    terminal_failure: true,
    blocked_evidence: true,
    execution_evidence: executionEvidence,
    at: timestamp
  };
  const eventsToWrite = [];
  if (!current) {
    eventsToWrite.push(
      { ...common, event_id: crypto.randomUUID(), from_state: null, to_state: 'queued', sequence: 1 },
      { ...common, event_id: crypto.randomUUID(), from_state: 'queued', to_state: 'claimed', sequence: 2 },
      { ...common, event_id: crypto.randomUUID(), from_state: 'claimed', to_state: 'running', sequence: 3 }
    );
  } else if (isTerminalTaskState(current.to_state)) {
    return { ok: false, code: 'terminal_task_cannot_transition', task_id: taskId };
  }
  eventsToWrite.push({
    ...common,
    event_id: crypto.randomUUID(),
    from_state: current?.to_state ?? 'running',
    to_state: 'failed',
    sequence: (current?.sequence ?? (eventsToWrite.at(-1)?.sequence ?? 0)) + 1
  });
  const file = taskLedgerPath(repoRoot);
  const transaction = {
    schema_version: 1,
    kind: 'terminal_failure_transaction',
    transaction_id: crypto.randomUUID(),
    recovery_id: resolvedRecoveryId,
    controller_fingerprint,
    events: eventsToWrite
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(file, `${JSON.stringify(transaction)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    return { ok: false, code: 'ledger_append_failed', error: error.message };
  }
  return { ok: true, code: 'terminal_failure_recorded', task_id: taskId, recovery_id: resolvedRecoveryId, event: eventsToWrite.at(-1) };
}

export function validateTaskLedger(events) {
  const projection = new Map();
  for (const event of events) {
    const verdict = validateTransition({ previous: projection.get(event.task_id), ...event });
    if (!verdict.ok) return { ok: false, ...verdict, event };
    projection.set(event.task_id, event);
  }
  return { ok: true, projection };
}

export function taskIsExecutable(task) {
  const missing = [];
  if (!task?.task_id) missing.push('task_id');
  if (!Array.isArray(task?.patch_targets) || task.patch_targets.length === 0) missing.push('patch_targets');
  if (!Array.isArray(task?.verification_commands) || task.verification_commands.length === 0) missing.push('verification_commands');
  if (task?.route === 'blocker') missing.push('implementation_route');
  return { ok: missing.length === 0, missing };
}

function appendLedgerRecord(repoRoot, record) {
  const file = taskLedgerPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function unclaimedTrajectoryRecord({ type, runId, claimPath, claimState, errorCode = null, errorMessage = null, at }) {
  return {
    schema_version: 1,
    kind: 'unclaimed_trajectory',
    event_id: crypto.randomUUID(),
    task_id: null,
    claim_id: null,
    trajectory_type: type,
    run_id: runId ?? null,
    claim_path: claimPath,
    claim_state: claimState,
    error_code: errorCode,
    error_message: errorMessage,
    at: at ?? new Date().toISOString()
  };
}

export function recordTrajectory(repoRoot, {
  claimPath,
  todoPath,
  type,
  runId,
  payloadRaw,
  at,
  readClaim = readClaimSnapshot
}) {
  let snapshot;
  try {
    snapshot = readClaim(claimPath);
  } catch (error) {
    snapshot = {
      ok: false,
      state: error?.code === 'ENOENT' ? 'absent' : 'unreadable',
      error
    };
  }
  if (!snapshot.ok) {
    const errorCode = snapshot.state === 'absent'
      ? 'claim_absent'
      : snapshot.state === 'malformed' ? 'claim_malformed' : 'claim_unreadable';
    const record = unclaimedTrajectoryRecord({
      type,
      runId,
      claimPath,
      claimState: snapshot.state,
      errorCode,
      errorMessage: snapshot.error?.message ?? null,
      at
    });
    try {
      appendLedgerRecord(repoRoot, record);
    } catch (error) {
      return {
        ok: false,
        code: 'ledger_append_failed',
        claim_state: snapshot.state,
        error: error.message,
        record
      };
    }
    if (snapshot.state === 'absent') {
      return { ok: true, code: 'unclaimed_empty', record };
    }
    return { ok: false, code: errorCode, error: snapshot.error?.message ?? errorCode, record };
  }

  const claimPathForId = claimPath;
  const claim = snapshot.claim;
  const first = String(claim.selected_todo ?? '').split('\n')[0] ?? '';
  const match = first.match(/^(?:[-*]|\d+[.)])\s+\[\s\]\s+([^:\s]+)/u);
  const sourceTaskId = match?.[1] ?? '';
  const claimId = claim.claim_id ?? null;
  const spec = String(claim.selected_todo ?? '');
  if (!claimId || !spec || !sourceTaskId) {
    const record = unclaimedTrajectoryRecord({
      type,
      runId,
      claimPath: claimPathForId,
      claimState: 'malformed',
      errorCode: 'claim_fields_missing',
      errorMessage: 'claim_id and selected_todo with a TODO id are required',
      at
    });
    try {
      appendLedgerRecord(repoRoot, record);
    } catch (error) {
      return { ok: false, code: 'ledger_append_failed', error: error.message, record };
    }
    return { ok: false, code: 'claim_fields_missing', error: record.error_message, record };
  }

  let events;
  try {
    events = readTaskLedger(repoRoot);
  } catch (error) {
    return { ok: false, code: 'ledger_append_failed', error: error.message };
  }
  const projectedSourceTask = taskProjection(events).get(sourceTaskId);
  // Replan creates the replacement child as the durable queued task itself.
  // Once that child is claimed, keep transitioning the raw child id so the
  // parent -> replacement -> terminal graph remains connected.  A terminal
  // replacement is deliberately not reopened: a later retry gets its own
  // immutable task attempt, just like an ordinary TODO retry.
  const replacementParentTaskId = projectedSourceTask?.parent_task_id ?? null;
  const continuesSameReplacementClaim = replacementParentTaskId
    && !isTerminalTaskState(projectedSourceTask.to_state)
    && ((projectedSourceTask.claim_id ?? null) === null
      || (projectedSourceTask.claim_id ?? null) === (claimId ?? null));
  const taskId = continuesSameReplacementClaim
    ? sourceTaskId
    : taskAttemptId(sourceTaskId, claimId);
  if (replacementParentTaskId
    && !isTerminalTaskState(projectedSourceTask.to_state)
    && projectedSourceTask.claim_id
    && projectedSourceTask.claim_id !== claimId) {
    let abandoned;
    try {
      abandoned = appendTaskTransition(repoRoot, {
        task_id: sourceTaskId,
        to_state: 'failed',
        run_id: runId,
        claim_id: projectedSourceTask.claim_id,
        reason: 'stale_claim_replaced',
        parent_task_id: replacementParentTaskId
      });
    } catch (error) {
      return { ok: false, code: 'ledger_append_failed', error: error.message };
    }
    if (!abandoned.ok) {
      return { ok: false, code: 'ledger_transition_rejected', task_id: sourceTaskId, rejected: abandoned };
    }
  }
  const specHash = crypto.createHash('sha256').update(spec).digest('hex');
  if (type === 'todo.replanned') {
    let payload = {};
    try { payload = JSON.parse(payloadRaw ?? '{}'); } catch { /* use the event name below */ }
    const reason = String(payload.reason ?? 'trajectory_replanned');
    const children = replacementChildren(todoPath, sourceTaskId);
    if (children.length === 0) return { ok: true, code: 'trajectory_without_replacement', task_id: taskId };
    let result;
    try {
      result = replanTaskWithChildren(repoRoot, {
        task_id: taskId,
        reason,
        children,
        run_id: runId,
        claim_id: claimId,
        task_spec_sha256: specHash,
        at
      });
    } catch (error) {
      return { ok: false, code: 'ledger_append_failed', error: error.message };
    }
    if (!result.ok) return { ok: false, code: 'ledger_transition_rejected', task_id: taskId, rejected: result };
    if (result.duplicate) return { ok: true, code: 'duplicate_trajectory', task_id: taskId, duplicate: result };
    return result;
  }
  const transitions = {
    'todo.claimed': ['queued', 'claimed'],
    'workflow.routed': ['running'],
    'todo.completed': ['completed'],
    'todo.blocked': ['blocked'],
    'todo.failed': ['failed']
  }[type] ?? [];
  const transitionStates = type === 'todo.claimed' && taskId === sourceTaskId
    ? ['claimed']
    : transitions;
  let duplicate = false;
  for (const to_state of transitionStates) {
    let result;
    try {
      result = appendTaskTransition(repoRoot, {
        task_id: taskId,
        to_state,
        at,
        run_id: runId,
        claim_id: claimId,
        task_spec_sha256: specHash,
        parent_task_id: replacementParentTaskId,
        reason: to_state === 'blocked' ? 'trajectory_blocked' : to_state === 'failed' ? 'trajectory_failed' : undefined
      });
    } catch (error) {
      return { ok: false, code: 'ledger_append_failed', error: error.message };
    }
    if (!result.ok) {
      return { ok: false, code: 'ledger_transition_rejected', task_id: taskId, rejected: result };
    }
    duplicate ||= result.code === 'duplicate_transition';
  }
  return { ok: true, code: duplicate ? 'duplicate_trajectory' : 'trajectory_recorded', task_id: taskId };
}

// A TODO can be retried after an interrupted or failed claim. The ledger is
// append-only and deliberately never reopens a terminal record, so its key
// identifies one execution attempt while sourceTaskId remains the TODO key.
export function taskAttemptId(sourceTaskId, claimId) {
  return claimId ? `${sourceTaskId}@${claimId}` : sourceTaskId;
}

function replacementChildren(todoPath, parentTaskId) {
  if (!todoPath || !fs.existsSync(todoPath)) return [];
  const blocks = fs.readFileSync(todoPath, 'utf8').split(/\n(?=(?:[-*]|\d+[.)])\s+\[ \]\s+)/u);
  const escapedParent = parentTaskId.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
  return blocks.flatMap((block) => {
    if (!new RegExp(`Source TODO:\\s*${escapedParent}\\.`, 'u').test(block)) return [];
    const taskId = block.match(/^(?:[-*]|\d+[.)])\s+\[ \]\s+([^:\s]+)/u)?.[1];
    const targets = [...block.matchAll(/`([^`]+)`/gu)].map((match) => match[1]).filter((value) => /[/.]/u.test(value));
    const verification = [...block.matchAll(/^\s*Verification:\s*run\s+`([^`]+)`/gmu)].map((match) => match[1]);
    const route = block.match(/^\s*Route:\s*([^\s.]+)/mu)?.[1] ?? 'implementation';
    return taskId ? [{ task_id: taskId, route, patch_targets: targets, verification_commands: verification }] : [];
  });
}

// The CLI is deliberately an adapter: phase-loop may continue to emit its
// historical trajectory while this ledger becomes the durable state authority.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname) && process.argv[2] === 'record-trajectory') {
  const args = new Map(process.argv.slice(3).reduce((pairs, value, index, values) => (
    value.startsWith('--') ? [...pairs, [value.slice(2), values[index + 1]]] : pairs
  ), []));
  const repo = args.get('repo');
  const claimPath = args.get('claim');
  const type = args.get('type');
  const runId = args.get('run');
  const todoPath = args.get('todo');
  const payloadRaw = args.get('payload');
  if (!repo || !claimPath || !type) process.exit(2);
  const result = recordTrajectory(repo, {
    claimPath,
    todoPath,
    type,
    runId,
    payloadRaw
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exit(78);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname) && process.argv[2] === 'record-terminal-failure') {
  const args = new Map(process.argv.slice(3).reduce((pairs, value, index, values) => (
    value.startsWith('--') ? [...pairs, [value.slice(2), values[index + 1]]] : pairs
  ), []));
  const repo = args.get('repo');
  if (!repo || !args.get('selected-todo')) process.exit(2);
  const result = recordTerminalFailureRecovery(repo, {
    selected_todo: args.get('selected-todo'),
    claim_id: args.get('claim-id') || null,
    run_id: args.get('run') || null,
    queue_generation: args.get('queue-generation') || null,
    queue_fingerprint: args.get('queue-fingerprint') || null,
    provider_failure_fingerprint: args.get('provider-failure-fingerprint') || null,
    retry_cap: args.get('retry-cap') || 0,
    controller_fingerprint: args.get('controller-fingerprint') || null,
    execution_evidence: args.get('execution-evidence') || null,
    recovery_id: args.get('recovery-id') || null,
    claim_absent: args.get('claim-absent') === 'true',
    blocked_reason: args.get('blocked-reason') || 'terminal_runtime_failure'
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exit(78);
}
