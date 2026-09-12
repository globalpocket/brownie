import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runRuntimeOperationalEvidenceGuard,
  validateRuntimeOperationalEvidence
} from './guard-runtime-operational-evidence.mjs';

const requiredSections = ['artifact_lifecycle', 'golden_journey_fixture', 'soak_test'];

function validContract(overrides = {}) {
  return {
    local_release_gate: {
      commands: [
        { command: 'pnpm --workspace-root release:runtime-operational-evidence' },
        { command: 'pnpm --workspace-root guard:runtime-operational-evidence' },
        { command: 'pnpm --workspace-root guard:runtime-operational-evidence:test' }
      ]
    },
    runtime_operational_evidence: {
      contract_id: 'brownie-runtime-operational-evidence-v1',
      default_path: '.brownie/release-evidence/runtime-operational-evidence.json',
      required_sections: requiredSections
    },
    ...overrides
  };
}

function section(status = 'satisfied', extra = {}) {
  return {
    status,
    release_blocking: true,
    ...extra
  };
}

function validEvidence(overrides = {}) {
  return {
    schema_version: 1,
    evidence_id: 'brownie-runtime-operational-evidence-v1',
    repository: 'globalpocket/brownie',
    release_ready: false,
    runtime_release_ready: false,
    required_sections: requiredSections,
    fail_closed_reasons: [],
    sections: {
      artifact_lifecycle: section('satisfied', {
        lifecycle_results: [
          {
            target: 'darwin-arm64',
            path: '.brownie/release-evidence/artifacts/darwin-arm64/brownie',
            status: 'satisfied',
            passed: true,
            checksum_verified: true,
            uninstalled: true,
            commands: [{ command: 'brownie --version', exit_code: 0, passed: true }]
          }
        ]
      }),
      golden_journey_fixture: section('satisfied', {
        commands: [{ command: 'brownie help run', exit_code: 0, passed: true }]
      }),
      soak_test: section('satisfied', {
        iterations_requested: 100,
        iterations_completed: 100,
        failure_count: 0,
        failure_rate: 0,
        duplicate_side_effects_observed: false,
        unrecoverable_run_count: 0,
        commands: [{ command: 'brownie --version', exit_code: 0, passed: true }]
      })
    },
    ...overrides
  };
}

test('accepts satisfied runtime operational evidence', () => {
  assert.deepEqual(validateRuntimeOperationalEvidence(validEvidence()), []);
});

test('accepts contract-only mode when generated runtime operational evidence is absent', () => {
  const result = runRuntimeOperationalEvidenceGuard({
    repoRoot: process.cwd(),
    contract: validContract(),
    evidencePath: '.brownie/release-evidence/not-yet-generated-runtime-operational-evidence.json'
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.validatedEvidence, false);
});

test('rejects incomplete golden journey fixture evidence', () => {
  const evidence = validEvidence();
  evidence.sections.golden_journey_fixture = section('not_executed_missing_artifacts', { commands: [] });
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('fail_closed_reasons must include golden_journey_fixture')));
});

test('accepts fail-closed golden journey with explicit reason', () => {
  const evidence = validEvidence({
    fail_closed_reasons: ['golden_journey_fixture:not_executed_missing_artifacts']
  });
  evidence.sections.golden_journey_fixture = section('not_executed_missing_artifacts', { commands: [] });
  assert.deepEqual(validateRuntimeOperationalEvidence(evidence), []);
});

test('rejects release-ready claims', () => {
  const errors = validateRuntimeOperationalEvidence(validEvidence({ runtime_release_ready: true }));
  assert(errors.some((error) => error.includes('runtime_release_ready true')));
});

test('requires fail-closed reasons for incomplete artifact lifecycle evidence', () => {
  const evidence = validEvidence();
  evidence.sections.artifact_lifecycle = section('failed', {
    lifecycle_results: [
      {
        target: 'darwin-arm64',
        path: '.brownie/release-evidence/artifacts/darwin-arm64/brownie',
        status: 'failed',
        passed: false,
        commands: [{ command: 'brownie --version', exit_code: 1, passed: false }]
      }
    ]
  });
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('fail_closed_reasons must include artifact_lifecycle')));
});

test('accepts fail-closed incomplete sections with explicit reasons', () => {
  const evidence = validEvidence({
    fail_closed_reasons: [
      'artifact_lifecycle:not_executed_missing_artifacts',
      'golden_journey_fixture:not_executed_missing_artifacts',
      'soak_test:not_executed_missing_artifacts'
    ]
  });
  evidence.sections.artifact_lifecycle = section('not_executed_missing_artifacts', { lifecycle_results: [] });
  evidence.sections.golden_journey_fixture = section('not_executed_missing_artifacts', { commands: [] });
  evidence.sections.soak_test = section('not_executed_missing_artifacts', {
    iterations_requested: 100,
    iterations_completed: 0,
    failure_count: 0,
    failure_rate: 1
  });
  assert.deepEqual(validateRuntimeOperationalEvidence(evidence), []);
});

test('accepts fail-closed artifact lifecycle when cross-platform artifacts are host-incompatible', () => {
  const evidence = validEvidence({
    fail_closed_reasons: ['artifact_lifecycle:failed']
  });
  evidence.sections.artifact_lifecycle = section('failed', {
    lifecycle_results: [
      {
        target: 'linux-x64',
        path: '.brownie/release-evidence/artifacts/linux-x64/brownie',
        status: 'not_executed_incompatible_host',
        passed: false,
        checksum_verified: true,
        host_target: 'darwin-arm64',
        commands: []
      }
    ]
  });
  assert.deepEqual(validateRuntimeOperationalEvidence(evidence), []);
});

test('rejects satisfied soak evidence with failures', () => {
  const evidence = validEvidence();
  evidence.sections.soak_test.failure_count = 1;
  evidence.sections.soak_test.failure_rate = 0.01;
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('zero failures')));
});

test('rejects satisfied artifact lifecycle with failed command', () => {
  const evidence = validEvidence();
  evidence.sections.artifact_lifecycle.lifecycle_results[0].commands[0] = {
    command: 'brownie --version',
    exit_code: 1,
    passed: false
  };
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('must pass')));
});

test('rejects satisfied golden journey with failed command', () => {
  const evidence = validEvidence();
  evidence.sections.golden_journey_fixture.commands[0] = {
    command: 'brownie help run',
    exit_code: 1,
    passed: false
  };
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('must pass')));
});
