#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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

export function isTerminalTaskState(state) {
  return TERMINAL_STATES.has(state);
}

export function readTaskLedger(repoRoot) {
  const file = taskLedgerPath(repoRoot);
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
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
  const events = readTaskLedger(repoRoot);
  const current = taskProjection(events).get(input.task_id);
  const toState = input.to_state ?? input.toState;
  const verdict = validateTransition({ previous: current, toState, ...input });
  if (!verdict.ok) return verdict;
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
    task_spec_sha256: input.task_spec_sha256 ?? null
  };
  const file = taskLedgerPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { ok: true, event };
}

// Replanning is a single ledger commit: the original task becomes terminal
// only in the same append that introduces every replacement child.  The TODO
// markdown remains a compatibility projection during migration; consumers
// must not infer task state from it.
export function replanTaskWithChildren(repoRoot, { task_id, reason, children, run_id = null, claim_id = null, task_spec_sha256 = null, at }) {
  if (!Array.isArray(children) || children.length === 0) return { ok: false, code: 'replan_requires_reason_and_children' };
  const events = readTaskLedger(repoRoot);
  const projection = taskProjection(events);
  const parent = projection.get(task_id);
  const childIds = children.map((child) => child?.task_id);
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
  // One synchronous append makes a partially written replacement set
  // detectable as an invalid JSONL tail rather than a visible parent-only
  // replan.  The writer only exposes the events after all validation above.
  fs.appendFileSync(file, `${[parentEvent, ...childEvents].map((event) => JSON.stringify(event)).join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  return { ok: true, events: [parentEvent, ...childEvents] };
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

function taskIdFromClaim(claimPath) {
  const claim = JSON.parse(fs.readFileSync(claimPath, 'utf8'));
  const first = String(claim.selected_todo ?? '').split('\n')[0] ?? '';
  const match = first.match(/^(?:[-*]|\d+[.)])\s+\[\s\]\s+([^:\s]+)/u);
  return { taskId: match?.[1] ?? '', claimId: claim.claim_id ?? null, spec: String(claim.selected_todo ?? '') };
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
  if (!repo || !claimPath || !type) process.exit(2);
  const { taskId, claimId, spec } = taskIdFromClaim(claimPath);
  if (!taskId) process.exit(0);
  const specHash = crypto.createHash('sha256').update(spec).digest('hex');
  const transitions = {
    'todo.claimed': ['queued', 'claimed'],
    'workflow.routed': ['running'],
    'skill.selected': ['running'],
    'todo.completed': ['completed'],
    'todo.blocked': ['blocked']
  }[type] ?? [];
  for (const to_state of transitions) {
    const result = appendTaskTransition(repo, {
      task_id: taskId,
      to_state,
      run_id: runId,
      claim_id: claimId,
      task_spec_sha256: specHash,
      reason: to_state === 'blocked' ? 'trajectory_blocked' : undefined
    });
    if (!result.ok && result.code !== 'terminal_task_cannot_transition') process.exit(1);
  }
}
