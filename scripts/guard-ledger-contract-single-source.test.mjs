import assert from 'node:assert/strict';
import test from 'node:test';

import { validateLedgerContractSingleSource } from './guard-ledger-contract-single-source.mjs';

const variants = ['TaskCompleted', 'WorkspacePatchApprovalRequested', 'ToolPlanApproved'];

function strictEntry(kind, version = 3) {
  return {
    ledger_event_kind: kind,
    payload_schema_classification: 'strict_typed',
    payload_schema_contract_status: 'closed',
    release_blocking_until_typed: false,
    payload_schema_version: version,
    payload_schema_id: `ledger_payload.${kind}.v${version}`,
    payload_schema_fingerprint: `shape-fnv1a64:${kind.toLowerCase().padEnd(16, '0').slice(0, 16)}`,
    payload_schema_descriptor: `${kind}:strict_typed:true;additional_fields:false`,
    store_schema_version: 2
  };
}

function absentEntry(kind, version = 12) {
  return {
    ledger_event_kind: kind,
    payload_schema_classification: 'payload_absent',
    payload_schema_contract_status: 'closed',
    release_blocking_until_typed: false,
    payload_schema_version: version,
    payload_schema_id: `ledger_payload.${kind}.v${version}`,
    payload_schema_fingerprint: `shape-fnv1a64:${kind.toLowerCase().padEnd(16, '0').slice(0, 16)}`,
    payload_schema_descriptor: `${kind}:payload_absent:true`,
    store_schema_version: 2
  };
}

function fixtureFor(entry) {
  return {
    ledger_event_kind: entry.ledger_event_kind,
    payload: { known: 'value' },
    payload_schema_classification: entry.payload_schema_classification,
    payload_schema_contract_status: entry.payload_schema_contract_status,
    payload_schema_id: entry.payload_schema_id,
    payload_schema_fingerprint: entry.payload_schema_fingerprint,
    payload_instance_shape_descriptor: 'object{known:string}',
    payload_instance_shape_fingerprint: 'shape-fnv1a64:1234567890abcdef'
  };
}

function validInputs(overrides = {}) {
  const fingerprints = [
    strictEntry('TaskCompleted'),
    absentEntry('WorkspacePatchApprovalRequested'),
    strictEntry('ToolPlanApproved', 5)
  ];
  const classifications = fingerprints.map((entry) => ({
    ledger_event_kind: entry.ledger_event_kind,
    payload_schema_classification: entry.payload_schema_classification,
    payload_schema_contract_status: entry.payload_schema_contract_status,
    release_blocking_until_typed: entry.release_blocking_until_typed
  }));
  const fixtures = fingerprints
    .filter((entry) => entry.payload_schema_classification === 'strict_typed')
    .map(fixtureFor);
  const contract = {
    generated_by: {
      module: 'brownie_protocol::semantic_contract'
    },
    durable_event_migration_coupling: {
      ledger_event_kind_source: 'crates/brownie-store/src/lib.rs',
      ledger_payload_schema_version_source:
        'brownie_protocol::semantic_contract::ledger_payload_schema_version(kind)',
      ledger_payload_contract_scope: {
        ledger_event_payload_typed_schema_coverage: 'closed'
      },
      event_payload_schema_classification_count: variants.length,
      event_payload_schema_classifications: classifications,
      release_blocking_open_payload_count: 0,
      event_payload_schema_fingerprint_count: variants.length,
      event_payload_schema_fingerprints: fingerprints,
      payload_schema_fixtures: fixtures
    }
  };
  const storeText = `
    pub enum LedgerEventKind {
        TaskCompleted,
        WorkspacePatchApprovalRequested,
        ToolPlanApproved,
    }
    fn validate_strict_ledger_payload_schema(kind: &LedgerEventKind, payload: &serde_json::Value) -> Result<()> {
        match kind {
            LedgerEventKind::TaskCompleted => validate_task_completed_payload_schema(payload),
            LedgerEventKind::ToolPlanApproved => validate_tool_plan_payload_schema(kind, payload),
            _ => bail!("not registered"),
        }
    }
  `;
  const semanticSourceText = `
    pub fn ledger_payload_schema_version(kind: &str) -> u64 {
      match kind {
        "TaskCompleted" => 3,
        "WorkspacePatchApprovalRequested" => 12,
        "ToolPlanApproved" => 5,
        _ => 13
      }
    }
  `;
  const packageJson = {
    scripts: {
      'guard:ledger-contract-single-source': 'node scripts/guard-ledger-contract-single-source.mjs',
      'guard:ledger-contract-single-source:test':
        'node --test scripts/guard-ledger-contract-single-source.test.mjs'
    }
  };
  const vsixPackageJson = {
    scripts: {
      check:
        'pnpm --workspace-root guard:ledger-contract-single-source && pnpm --workspace-root guard:ledger-contract-single-source:test'
    }
  };
  const releaseGateCommands = [
    {
      command: 'pnpm',
      args: ['--workspace-root', 'guard:ledger-contract-single-source']
    },
    {
      command: 'pnpm',
      args: ['--workspace-root', 'guard:ledger-contract-single-source:test']
    }
  ];
  const ciText = 'run: pnpm --filter brownie-vsix check';
  return {
    contract,
    storeText,
    semanticSourceText,
    packageJson,
    vsixPackageJson,
    releaseGateCommands,
    ciText,
    ...overrides
  };
}

test('accepts complete Ledger Contract single-source wiring', () => {
  assert.deepEqual(validateLedgerContractSingleSource(validInputs()), []);
});

test('rejects LedgerEventKind missing from semantic contract inventory', () => {
  const inputs = validInputs();
  inputs.contract.durable_event_migration_coupling.event_payload_schema_classifications.pop();
  inputs.contract.durable_event_migration_coupling.event_payload_schema_classification_count -= 1;
  const errors = validateLedgerContractSingleSource(inputs);
  assert(errors.some((error) => error.includes('ToolPlanApproved must have a payload schema classification')));
});

test('rejects strict typed event without Runtime validator dispatch', () => {
  const inputs = validInputs({
    storeText: validInputs().storeText.replace(
      'LedgerEventKind::ToolPlanApproved => validate_tool_plan_payload_schema(kind, payload),',
      ''
    )
  });
  const errors = validateLedgerContractSingleSource(inputs);
  assert(errors.some((error) => error.includes('ToolPlanApproved strict_typed payload must be wired')));
});

test('rejects strict typed event without generated fixture', () => {
  const inputs = validInputs();
  inputs.contract.durable_event_migration_coupling.payload_schema_fixtures =
    inputs.contract.durable_event_migration_coupling.payload_schema_fixtures.filter(
      (fixture) => fixture.ledger_event_kind !== 'ToolPlanApproved'
    );
  const errors = validateLedgerContractSingleSource(inputs);
  assert(errors.some((error) => error.includes('ToolPlanApproved strict_typed payload must have at least one generated schema fixture')));
});

test('rejects fixture whose schema fingerprint no longer matches canonical fingerprint entry', () => {
  const inputs = validInputs();
  inputs.contract.durable_event_migration_coupling.payload_schema_fixtures[0].payload_schema_fingerprint =
    'shape-fnv1a64:ffffffffffffffff';
  const errors = validateLedgerContractSingleSource(inputs);
  assert(errors.some((error) => error.includes('fixture schema fingerprint must match fingerprint entry')));
});

test('rejects VSIX check that only invokes the test variant', () => {
  const inputs = validInputs({
    vsixPackageJson: {
      scripts: {
        check: 'pnpm --workspace-root guard:ledger-contract-single-source:test'
      }
    }
  });
  const errors = validateLedgerContractSingleSource(inputs);
  assert(errors.some((error) => error.includes('check must invoke pnpm --workspace-root guard:ledger-contract-single-source.')));
});

test('rejects release gate that omits the ledger guard', () => {
  const inputs = validInputs({
    releaseGateCommands: [
      {
        command: 'pnpm',
        args: ['--workspace-root', 'guard:ledger-contract-single-source:test']
      }
    ]
  });
  const errors = validateLedgerContractSingleSource(inputs);
  assert(errors.some((error) => error.includes('release:gate required commands must include pnpm --workspace-root guard:ledger-contract-single-source.')));
});
