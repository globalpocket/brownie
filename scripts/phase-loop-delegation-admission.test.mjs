import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { delegationAdmissionStatus, recordDelegationAdmission } from './phase-loop-delegation-admission.mjs';

function fixture(feedback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-delegation-admission-'));
  const feedbackPath = path.join(root, 'repair-feedback.json');
  const auditPath = path.join(root, 'delegation-admission.jsonl');
  fs.writeFileSync(feedbackPath, JSON.stringify(feedback));
  return { feedbackPath, auditPath };
}

test('admits an existing brownie-agent controller-maintenance handoff without a second approval gate', () => {
  const paths = fixture({
    kind: 'phase_loop_delegation_pending',
    completed: false,
    selected_todo: '- [ ] controller-maintenance-ledger-recovery: repair the phase loop',
    delegation: { required_actor: 'brownie-agent', acknowledgement_required: true, status: 'pending' }
  });
  const result = recordDelegationAdmission({ ...paths, now: '2026-10-18T03:00:00.000Z' });
  assert.equal(result.ok, true);
  assert.equal(result.recorded, true);
  assert.equal(result.record.required_actor, 'brownie-agent');
  assert.equal(result.record.alternative_unavailable, true);
  assert.equal(result.record.authority, 'existing_controller_maintenance_implementation_policy');
  assert.equal(result.record.acknowledgement_due_at, '2026-10-18T03:30:00.000Z');
  assert.deepEqual(delegationAdmissionStatus({ ...paths, now: '2026-10-18T03:10:00.000Z' }), {
    ok: true,
    pending: true,
    state: 'awaiting_acknowledgement',
    required_actor: 'brownie-agent',
    acknowledgement_due_at: '2026-10-18T03:30:00.000Z',
    admission_id: result.record.admission_id
  });
  assert.equal(delegationAdmissionStatus({ ...paths, now: '2026-10-18T03:30:00.000Z' }).state, 'overdue');
  const second = recordDelegationAdmission({ ...paths, now: '2026-10-18T03:01:00.000Z' });
  assert.deepEqual(second, { ok: true, recorded: false, reason: 'already_received', record: result.record });
});

test('does not admit unrelated or malformed handoffs as implementation work', () => {
  const unrelated = fixture({ kind: 'other', delegation: { required_actor: 'brownie-agent' } });
  assert.deepEqual(recordDelegationAdmission(unrelated), { ok: true, recorded: false, reason: 'not_pending_brownie_agent_handoff' });
  const malformed = fixture({ kind: 'phase_loop_delegation_pending', delegation: { required_actor: 'globalpocket', status: 'pending' } });
  assert.deepEqual(recordDelegationAdmission(malformed), { ok: true, recorded: false, reason: 'not_pending_brownie_agent_handoff' });
  const missing = fixture({ kind: 'phase_loop_delegation_pending', delegation: { required_actor: 'brownie-agent', status: 'pending' } });
  assert.deepEqual(recordDelegationAdmission(missing), { ok: true, recorded: false, reason: 'not_pending_brownie_agent_handoff' });
});

test('controller records handoff admission before preserving the fail-closed pending gate', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const controller = fs.readFileSync(path.join(repoRoot, 'phase-loop.sh'), 'utf8');
  assert.match(controller, /phase-loop-delegation-admission\.mjs.*record/us);
  assert.match(controller, /delegation_admission_failed/u);
  assert.match(controller, /required_actor.*brownie-agent/u);
  assert.match(controller, /phase_loop_delegation_blocker_detail\(\)/u);
  assert.match(controller, /brownie-agent implementation delegation is \{phase\}/u);
  assert.match(controller, /brownie-agent-delegation-\$run_stamp/u);
});
