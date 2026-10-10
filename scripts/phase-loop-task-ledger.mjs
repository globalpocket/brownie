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
      try {
        const record = JSON.parse(line);
        // A replacement set is projected only when its one-line journal
        // record is complete. A torn append therefore exposes no terminal
        // parent without its children.
        if (record?.kind === 'replan_transaction') {
          return Array.isArray(record.events) && record.events.length > 1 && record.events.every((event) => event?.task_id && TASK_STATES.has(event?.to_state))
            ? record.events : [];
        }
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
  const { taskId, claimId, spec } = taskIdFromClaim(claimPath);
  if (!taskId) process.exit(0);
  const specHash = crypto.createHash('sha256').update(spec).digest('hex');
  if (type === 'todo.replanned') {
    let payload = {};
    try { payload = JSON.parse(payloadRaw ?? '{}'); } catch { /* use the event name below */ }
    const result = replanTaskWithChildren(repo, {
      task_id: taskId,
      reason: String(payload.reason ?? 'trajectory_replanned'),
      children: replacementChildren(todoPath, taskId),
      run_id: runId,
      claim_id: claimId,
      task_spec_sha256: specHash
    });
    if (!result.ok && result.code !== 'terminal_task_cannot_transition') process.exit(1);
    process.exit(0);
  }
  const transitions = {
    'todo.claimed': ['queued', 'claimed'],
    'workflow.routed': ['running'],
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
