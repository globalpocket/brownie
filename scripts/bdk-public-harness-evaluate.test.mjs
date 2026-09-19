import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateBdkPublicHarnessTrajectory } from './bdk-public-harness-evaluate.mjs';

function record(type, payload = {}) {
  return {
    schema_version: 1,
    run_id: 'run-1',
    claim_id: 'claim-1',
    events: [
      {
        type,
        at: '2026-09-20T00:00:00Z',
        todo_id: 'E-16-test',
        claim_id: 'claim-1',
        payload
      }
    ]
  };
}

test('accepts a complete public harness trajectory', () => {
  const result = evaluateBdkPublicHarnessTrajectory([
    record('todo.claimed'),
    record('workflow.routed'),
    record('skill.selected'),
    record('progress.classified', { classification: 'progress' }),
    record('verification.run', { completed: true }),
    record('todo.completed')
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.terminal_event_count, 1);
});

test('rejects missing terminal event in strict mode', () => {
  const result = evaluateBdkPublicHarnessTrajectory([
    record('todo.claimed'),
    record('workflow.routed'),
    record('skill.selected')
  ]);
  assert.equal(result.ok, false);
  assert(result.failures.some((failure) => failure.class === 'terminal_event_missing'));
});

test('rejects private paths in public harness payloads', () => {
  const result = evaluateBdkPublicHarnessTrajectory([
    record('todo.claimed'),
    record('workflow.routed', {
      prompt_meta: '/Users/satoshitanaka/Documents/brownie/.brownie/private/phase-loop/runs/run.prompt.meta.json'
    }),
    record('skill.selected'),
    record('todo.replanned')
  ]);
  assert.equal(result.ok, false);
  assert(result.failures.some((failure) => failure.class === 'forbidden_payload_detail'));
});
