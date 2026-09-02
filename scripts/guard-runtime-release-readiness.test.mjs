import assert from 'node:assert/strict';
import test from 'node:test';

import { validateRuntimeReleaseReadinessAudit } from './guard-runtime-release-readiness.mjs';

const ciText = [
  'pnpm guard:phase-value',
  'pnpm guard:phase-value:test',
  'pnpm --filter brownie-vsix check'
].join('\n');

const cargoText = 'license = "UNLICENSED"\npublish = false\n';
const vsixPackageText = 'pnpm --workspace-root guard:runtime-release-readiness';

function item(overrides) {
  return {
    id: 'runtime-boundary-protocol-contracts',
    title: 'Boundary Protocol gaps',
    priority: 'P0',
    status: 'partial',
    responsibility_domain: 'runtime',
    debt_classification: 'required_before_release',
    evidence: ['bounded evidence'],
    next_action: 'close later',
    ...overrides
  };
}

function validAudit(overrides = {}) {
  return {
    schema_version: 1,
    campaign: 'runtime-release-readiness-p0-p1-finite-closure',
    phase: 'RRD-1',
    runtime_release_ready: false,
    release_ready_blocked_by: [
      'runtime-boundary-protocol-contracts',
      'explicit-cancel-command',
      'real-process-loss-recovery-e2e',
      'durable-schema-version-and-migration',
      'runtime-release-guard-ci',
      'protocol-event-canonization',
      'runtime-module-decomposition-reevaluation',
      'platform-deadline-durability-hardening'
    ],
    owner_decisions: [
      {
        id: 'oss_license',
        status: 'required',
        reason: 'Owner must choose license.'
      }
    ],
    classifications: [
      item({
        id: 'runtime-release-debt-reaudit',
        title: 'Runtime Release debt reaudit',
        priority: 'P0',
        status: 'implemented_sufficient',
        debt_classification: 'closed'
      }),
      item(),
      item({ id: 'explicit-cancel-command', title: 'Cancel semantics' }),
      item({ id: 'real-process-loss-recovery-e2e', title: 'Real process loss Recovery E2E' }),
      item({ id: 'durable-schema-version-and-migration', title: 'Durable schema version and migration' }),
      item({
        id: 'runtime-release-guard-ci',
        title: 'CI Release Gate',
        priority: 'P0',
        status: 'partial'
      }),
      item({ id: 'protocol-event-canonization', title: 'Protocol/Event canonization', priority: 'P1' }),
      item({ id: 'runtime-module-decomposition-reevaluation', title: 'Runtime module decomposition reevaluation', priority: 'P1' }),
      item({ id: 'platform-deadline-durability-hardening', title: 'Platform, deadline, and durability hardening', priority: 'P1' }),
      item({
        id: 'oss-release-technical-basis',
        title: 'OSS Release technical basis',
        priority: 'P1',
        status: 'owner_decision_waiting',
        responsibility_domain: 'owner',
        debt_classification: 'owner_decision',
        owner_decision_required: 'oss_license'
      }),
      item({
        id: 'hosted-scheduler-daemon-worker-fleet',
        title: 'Hosted scheduler',
        priority: 'P2',
        status: 'runtime_outside',
        responsibility_domain: 'external_control_plane',
        debt_classification: 'post_v0'
      }),
      item({
        id: 'forge-notification-adapters',
        title: 'Forge adapters',
        priority: 'P2',
        status: 'runtime_outside',
        responsibility_domain: 'external_adapter',
        debt_classification: 'post_v0'
      }),
      item({
        id: 'enterprise-commercial-readiness',
        title: 'Enterprise readiness',
        priority: 'P2',
        status: 'runtime_outside',
        responsibility_domain: 'commercial_solution',
        debt_classification: 'post_v0'
      })
    ],
    ...overrides
  };
}

function terminalRuntimeReadyAudit(overrides = {}) {
  const audit = validAudit();
  return {
    ...audit,
    runtime_release_ready: true,
    release_ready_blocked_by: [],
    classifications: audit.classifications.map((entry) => {
      if (
        entry.responsibility_domain === 'runtime' &&
        ['P0', 'P1'].includes(entry.priority)
      ) {
        return {
          ...entry,
          status: 'implemented_sufficient',
          debt_classification: 'closed',
          evidence: ['bounded closure evidence']
        };
      }
      return entry;
    }),
    ...overrides
  };
}

function validate(audit, options = {}) {
  return validateRuntimeReleaseReadinessAudit(audit, {
    ciText,
    cargoText,
    vsixPackageText,
    ...options
  });
}

test('accepts bounded Runtime release readiness audit', () => {
  assert.deepEqual(validate(validAudit()), []);
});

test('accepts terminal Runtime release readiness audit after all Runtime blockers close', () => {
  assert.deepEqual(validate(terminalRuntimeReadyAudit()), []);
});

test('rejects declaring Runtime release ready with open required debt', () => {
  const errors = validate(validAudit({ runtime_release_ready: true }));
  assert(errors.some((error) => error.includes('runtime_release_ready')));
});

test('rejects stale not-ready decision after all Runtime blockers close', () => {
  const errors = validate(terminalRuntimeReadyAudit({ runtime_release_ready: false }));
  assert(errors.some((error) => error.includes('runtime_release_ready must be true')));
});

test('rejects release blockers that name closed Runtime items', () => {
  const errors = validate(terminalRuntimeReadyAudit({ release_ready_blocked_by: ['explicit-cancel-command'] }));
  assert(errors.some((error) => error.includes('release_ready_blocked_by must not include closed')));
});

test('rejects open Runtime P0 item misclassified as external post-v0 debt', () => {
  const audit = validAudit({
    classifications: validAudit().classifications.map((entry) =>
      entry.id === 'explicit-cancel-command'
        ? { ...entry, responsibility_domain: 'external_control_plane', debt_classification: 'post_v0' }
        : entry
    )
  });
  const errors = validate(audit);
  assert(errors.some((error) => error.includes('explicit-cancel-command must be Runtime-owned')));
});

test('rejects external item that blocks Runtime release', () => {
  const audit = validAudit({
    classifications: validAudit().classifications.map((entry) =>
      entry.id === 'hosted-scheduler-daemon-worker-fleet'
        ? { ...entry, debt_classification: 'required_before_release' }
        : entry
    )
  });
  const errors = validate(audit);
  assert(errors.some((error) => error.includes('hosted-scheduler-daemon-worker-fleet must remain post_v0')));
});

test('rejects missing owner license decision while workspace remains unpublished', () => {
  const audit = validAudit({ owner_decisions: [] });
  const errors = validate(audit);
  assert(errors.some((error) => error.includes('oss_license')));
});

test('rejects CI or VSIX check path that omits release readiness guard coverage', () => {
  const errors = validate(validAudit(), { ciText: 'pnpm install\npnpm guard:phase-value\n' });
  assert(errors.some((error) => error.includes('pnpm --filter brownie-vsix check')));

  const vsixErrors = validate(validAudit(), { vsixPackageText: 'pnpm --workspace-root guard:phase-value' });
  assert(vsixErrors.some((error) => error.includes('guard:runtime-release-readiness')));
});
