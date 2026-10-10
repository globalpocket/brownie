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

export function taskIsExecutable(task) {
  const missing = [];
  if (!task?.task_id) missing.push('task_id');
  if (!Array.isArray(task?.patch_targets) || task.patch_targets.length === 0) missing.push('patch_targets');
  if (!Array.isArray(task?.verification_commands) || task.verification_commands.length === 0) missing.push('verification_commands');
  if (task?.route === 'blocker') missing.push('implementation_route');
  return { ok: missing.length === 0, missing };
}
