import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HISTORICAL_LEDGER_GUARD_COMMAND,
  HISTORICAL_LEDGER_GUARD_TEST_COMMAND,
  validateHistoricalLedgerFixtures
} from './guard-historical-ledger-fixtures.mjs';

function validInputs(overrides = {}) {
  const packageJson = {
    scripts: {
      'guard:historical-ledger-fixtures': 'node scripts/guard-historical-ledger-fixtures.mjs',
      'guard:historical-ledger-fixtures:test':
        'node --test scripts/guard-historical-ledger-fixtures.test.mjs'
    }
  };
  const vsixPackageJson = {
    scripts: {
      check: `${HISTORICAL_LEDGER_GUARD_COMMAND} && ${HISTORICAL_LEDGER_GUARD_TEST_COMMAND}`
    }
  };
  const releaseGateCommands = [
    {
      command: 'pnpm',
      args: ['--workspace-root', 'guard:historical-ledger-fixtures']
    },
    {
      command: 'pnpm',
      args: ['--workspace-root', 'guard:historical-ledger-fixtures:test']
    }
  ];
  return {
    packageJson,
    vsixPackageJson,
    releaseGateCommands,
    storeText: [
      'fn durable_schema_v1_historical_fixture_preserves_task_run_ledger_checkpoint_and_resume_identity() {}',
      'fn ledger_read_rejects_historical_mismatched_payload_envelope_fixture() {}',
      'fn copy_historical_ledger_fixture() {}',
      '"tests"',
      '"fixtures"',
      '"historical-ledger"'
    ].join('\n'),
    v1Manifest: {
      schema_id: 'brownie-runtime-durable-store',
      manifest_format_version: 1,
      store_schema_version: 1,
      minimum_runtime_store_schema_version: 1,
      state: 'current',
      migration: 'initialized-v1'
    },
    v1State: {
      task_id: 'task_historical_v1_running_task',
      run_id: 'run_historical_v1_running_task',
      status: 'Running'
    },
    v1Admission: {
      admission_id: 'rrp-4-1-v1-fixture-admission',
      task_id: 'task_historical_v1_running_task',
      run_id: 'run_historical_v1_running_task'
    },
    v1LedgerText: [
      '{"event_id":"event_1","task_id":"task_historical_v1_running_task","run_id":"run_historical_v1_running_task","kind":"TaskStarted","timestamp":"2026-09-01T00:00:00Z"}',
      '{"event_id":"event_2","task_id":"task_historical_v1_running_task","run_id":"run_historical_v1_running_task","kind":"TaskRunning","timestamp":"2026-09-01T00:01:00Z"}'
    ].join('\n'),
    mismatchLedgerText:
      '{"event_id":"event_bad","task_id":"task_bad","run_id":"run_bad","kind":"TaskCompleted","timestamp":"2026-09-03T00:00:00Z","payload":{"status":"Completed"},"payload_envelope":{"schema_version":3,"shape_id":"ledger_payload.TaskCompleted.v3","shape_fingerprint":"shape-fnv1a64:0000000000000000","schema_id":"ledger_payload.TaskCompleted.v3","schema_fingerprint":"shape-fnv1a64:0000000000000000","instance_shape_fingerprint":"shape-fnv1a64:0000000000000000"}}',
    ...overrides
  };
}

test('accepts historical ledger fixture wiring and fixture contents', () => {
  assert.deepEqual(validateHistoricalLedgerFixtures(validInputs()), []);
});

test('rejects package script omissions', () => {
  const inputs = validInputs();
  delete inputs.packageJson.scripts['guard:historical-ledger-fixtures:test'];

  assert.match(validateHistoricalLedgerFixtures(inputs).join('\n'), /historical-ledger-fixtures:test/);
});

test('rejects VSIX check omissions', () => {
  const inputs = validInputs({
    vsixPackageJson: {
      scripts: {
        check: HISTORICAL_LEDGER_GUARD_COMMAND
      }
    }
  });

  assert.match(validateHistoricalLedgerFixtures(inputs).join('\n'), /check must invoke pnpm --workspace-root guard:historical-ledger-fixtures:test/);
});

test('rejects release gate omissions', () => {
  const inputs = validInputs({
    releaseGateCommands: [
      {
        command: 'pnpm',
        args: ['--workspace-root', 'guard:historical-ledger-fixtures:test']
      }
    ]
  });

  assert.match(validateHistoricalLedgerFixtures(inputs).join('\n'), /release:gate required commands must include pnpm --workspace-root guard:historical-ledger-fixtures/);
});

test('rejects v1 fixture that already contains a v2 layout marker', () => {
  const inputs = validInputs();
  inputs.v1Manifest.layout = 'runtime-store-v2-bounded-local-layout';

  assert.match(validateHistoricalLedgerFixtures(inputs).join('\n'), /must not include a v2 store-layout marker/);
});

test('rejects historical lifecycle drift', () => {
  const inputs = validInputs({
    v1LedgerText:
      '{"event_id":"event_1","task_id":"task_historical_v1_running_task","run_id":"run_historical_v1_running_task","kind":"TaskStarted","timestamp":"2026-09-01T00:00:00Z"}'
  });

  assert.match(validateHistoricalLedgerFixtures(inputs).join('\n'), /exactly two historical lifecycle events/);
});

test('rejects replay-rejection fixture without the mismatched fingerprint sentinel', () => {
  const inputs = validInputs({
    mismatchLedgerText:
      '{"event_id":"event_bad","task_id":"task_bad","run_id":"run_bad","kind":"TaskCompleted","timestamp":"2026-09-03T00:00:00Z","payload":{"status":"Completed"},"payload_envelope":{"schema_version":3,"instance_shape_fingerprint":"shape-fnv1a64:1111111111111111"}}'
  });

  assert.match(validateHistoricalLedgerFixtures(inputs).join('\n'), /mismatched instance fingerprint/);
});
