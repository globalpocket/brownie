import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  runProtocolEventCanonizationGuard,
  validateRuntimeProtocolEventCanonicalMap,
  validateRuntimeSemanticProtocolContract
} from './guard-protocol-event-canonization.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const mapPath = 'docs/architecture/runtime-protocol-event-canonical-map.json';
const semanticContractPath = 'docs/architecture/runtime-semantic-protocol-contract.json';

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readMap() {
  return JSON.parse(read(mapPath));
}

function readSemanticContract() {
  return JSON.parse(read(semanticContractPath));
}

test('validates the repository Runtime protocol/event canonical map', () => {
  assert.deepEqual(runProtocolEventCanonizationGuard({ repoRoot, skipRustGeneratedContractCheck: true }).errors, []);
});

test('rejects an unowned Runtime JSON-RPC method', () => {
  const runtimePath = 'crates/brownie-runtime/src/lib.rs';
  const errors = validateRuntimeProtocolEventCanonicalMap(readMap(), {
    repoRoot,
    mapPath,
    textByPath: {
      [runtimePath]: `${read(runtimePath)}\nconst METHOD_UNOWNED_TEST: &str = \"unowned.test\";\n`
    }
  });

  assert(errors.some((error) => error.includes('unowned.test')));
});

test('rejects a canonical method removed from Runtime dispatch', () => {
  const runtimePath = 'crates/brownie-runtime/src/lib.rs';
  const errors = validateRuntimeProtocolEventCanonicalMap(readMap(), {
    repoRoot,
    mapPath,
    textByPath: {
      [runtimePath]: read(runtimePath).replace('METHOD_TASK_CANCEL =>', 'METHOD_TASK_CANCEL_DRIFT =>')
    }
  });

  assert(errors.some((error) => error.includes('task.cancel must be covered by Runtime dispatch')));
});

test('rejects event ledger drift', () => {
  const storePath = 'crates/brownie-store/src/lib.rs';
  const errors = validateRuntimeProtocolEventCanonicalMap(readMap(), {
    repoRoot,
    mapPath,
    textByPath: {
      [storePath]: read(storePath).replace('TaskCancelled,', 'TaskCanceled,')
    }
  });

  assert(errors.some((error) => error.includes('LedgerEventKind must define TaskCancelled')));
});

test('rejects VSIX client projection drift for projected methods', () => {
  const vsixClientPath = 'extensions/brownie-vsix/src/runtime/runtimeClient.ts';
  const errors = validateRuntimeProtocolEventCanonicalMap(readMap(), {
    repoRoot,
    mapPath,
    textByPath: {
      [vsixClientPath]: read(vsixClientPath).replace("'task.cancel'", "'task.cancel.drift'")
    }
  });

  assert(errors.some((error) => error.includes('VSIX client must project task.cancel')));
});

test('rejects a stale semantic protocol contract artifact', () => {
  const contract = readSemanticContract();
  contract.contract_id = 'runtime-semantic-protocol-contract-drift';

  const errors = validateRuntimeSemanticProtocolContract(contract, readMap(), {
    repoRoot,
    contractPath: semanticContractPath,
    mapPath,
    skipRustGeneratedContractCheck: true
  });

  assert(errors.some((error) => error.includes('contract_id')));
});

test('rejects a semantic protocol contract missing an explicit Runtime method', () => {
  const contract = readSemanticContract();
  contract.method_contracts = contract.method_contracts.filter((method) => method.method !== 'headless.continue_once');

  const errors = validateRuntimeSemanticProtocolContract(contract, readMap(), {
    repoRoot,
    contractPath: semanticContractPath,
    mapPath,
    skipRustGeneratedContractCheck: true
  });

  assert(errors.some((error) => error.includes('method_contracts must include headless.continue_once')));
});

test('rejects missing Rust deny-unknown semantic evidence', () => {
  const protocolPath = 'crates/brownie-protocol/src/lib.rs';
  const errors = validateRuntimeSemanticProtocolContract(readSemanticContract(), readMap(), {
    repoRoot,
    contractPath: semanticContractPath,
    mapPath,
    skipRustGeneratedContractCheck: true,
    textByPath: {
      [protocolPath]: read(protocolPath).replace(/#\[serde\(deny_unknown_fields\)\]\s*pub struct TaskStartParams/, 'pub struct TaskStartParams')
    }
  });

  assert(errors.some((error) => error.includes('TaskStartParams must deny unknown fields')));
});

test('rejects missing semantic contract deny-unknown policy evidence', () => {
  const contract = readSemanticContract();
  contract.unknown_field_policy.rust_public_params = contract.unknown_field_policy.rust_public_params.filter((entry) => entry.type !== 'TaskStartParams');

  const errors = validateRuntimeSemanticProtocolContract(contract, readMap(), {
    repoRoot,
    contractPath: semanticContractPath,
    mapPath,
    skipRustGeneratedContractCheck: true
  });

  assert(errors.some((error) => error.includes('rust_public_params must cover every public Runtime *Params type')));
});

test('rejects missing recursive nested type schema evidence', () => {
  const contract = readSemanticContract();
  delete contract.type_schemas.ModePackReplaceActiveResult.$defs.ModePackActiveSnapshotSummary;

  const errors = validateRuntimeSemanticProtocolContract(contract, readMap(), {
    repoRoot,
    contractPath: semanticContractPath,
    mapPath,
    skipRustGeneratedContractCheck: true
  });

  assert(errors.some((error) => error.includes('recursively define nested ModePackActiveSnapshotSummary')));
});

test('rejects method contract without recursive schema refs', () => {
  const contract = readSemanticContract();
  const method = contract.method_contracts.find((entry) => entry.method === 'modepack.replaceActive');
  delete method.result_schema_ref;

  const errors = validateRuntimeSemanticProtocolContract(contract, readMap(), {
    repoRoot,
    contractPath: semanticContractPath,
    mapPath,
    skipRustGeneratedContractCheck: true
  });

  assert(errors.some((error) => error.includes('modepack.replaceActive must reference its recursive result type schema')));
});

test('rejects missing VSIX semantic golden tests', () => {
  const vsixTestPath = 'extensions/brownie-vsix/src/test/semanticProtocolContract.test.ts';
  const errors = validateRuntimeSemanticProtocolContract(readSemanticContract(), readMap(), {
    repoRoot,
    contractPath: semanticContractPath,
    mapPath,
    skipRustGeneratedContractCheck: true,
    textByPath: {
      [vsixTestPath]: read(vsixTestPath).replace('rejects unknown fields from semantic contract fixtures', 'rejects drifted fixture fields')
    }
  });

  assert(errors.some((error) => error.includes('rejects unknown fields from semantic contract fixtures')));
});

test('rejects protocol closure without durable event migration coupling', () => {
  const contract = readSemanticContract();
  contract.durable_event_migration_coupling.policy = 'event kind changes are documented';

  const errors = validateRuntimeSemanticProtocolContract(contract, readMap(), {
    repoRoot,
    contractPath: semanticContractPath,
    mapPath,
    skipRustGeneratedContractCheck: true
  });

  assert(errors.some((error) => error.includes('durable event changes must require migration policy')));
});

test('rejects protocol closure without durable ledger payload envelope evidence', () => {
  const storePath = 'crates/brownie-store/src/lib.rs';
  const errors = validateRuntimeSemanticProtocolContract(readSemanticContract(), readMap(), {
    repoRoot,
    contractPath: semanticContractPath,
    mapPath,
    skipRustGeneratedContractCheck: true,
    textByPath: {
      [storePath]: read(storePath).replaceAll('LedgerPayloadEnvelope', 'LedgerPayloadEnvelopeDrift')
    }
  });

  assert(errors.some((error) => error.includes('LedgerPayloadEnvelope')));
});

test('rejects payload schema fingerprints that vary with allowed instance fields', () => {
  const contract = readSemanticContract();
  const fixtures = contract.durable_event_migration_coupling.payload_schema_fixtures.filter(
    (fixture) => fixture.ledger_event_kind === 'TaskCompleted'
  );
  fixtures[1].payload_schema_fingerprint = 'shape-fnv1a64:ffffffffffffffff';

  const errors = validateRuntimeSemanticProtocolContract(contract, readMap(), {
    repoRoot,
    contractPath: semanticContractPath,
    mapPath,
    skipRustGeneratedContractCheck: true
  });

  assert(errors.some((error) => error.includes('fixed contract schema fingerprint')));
});

test('rejects payload schema fixtures without separate instance fingerprints', () => {
  const contract = readSemanticContract();
  const fixtures = contract.durable_event_migration_coupling.payload_schema_fixtures.filter(
    (fixture) => fixture.ledger_event_kind === 'TaskCompleted'
  );
  fixtures[1].payload_instance_shape_fingerprint = fixtures[0].payload_instance_shape_fingerprint;

  const errors = validateRuntimeSemanticProtocolContract(contract, readMap(), {
    repoRoot,
    contractPath: semanticContractPath,
    mapPath,
    skipRustGeneratedContractCheck: true
  });

  assert(errors.some((error) => error.includes('diagnostic instance shape fingerprints')));
});

test('rejects missing ledger event schema fingerprint evidence', () => {
  const contract = readSemanticContract();
  contract.durable_event_migration_coupling.event_payload_schema_fingerprints =
    contract.durable_event_migration_coupling.event_payload_schema_fingerprints.filter((entry) => entry.ledger_event_kind !== 'TaskCancelled');
  contract.durable_event_migration_coupling.event_payload_schema_fingerprint_count =
    contract.durable_event_migration_coupling.event_payload_schema_fingerprints.length;

  const errors = validateRuntimeSemanticProtocolContract(contract, readMap(), {
    repoRoot,
    contractPath: semanticContractPath,
    mapPath,
    skipRustGeneratedContractCheck: true
  });

  assert(errors.some((error) => error.includes('event_payload_schema_fingerprints must include TaskCancelled')));
});

test('rejects ledger payload contract without explicit per-event classification inventory', () => {
  const contract = readSemanticContract();
  contract.durable_event_migration_coupling.event_payload_schema_classifications =
    contract.durable_event_migration_coupling.event_payload_schema_classifications.filter((entry) => entry.ledger_event_kind !== 'TaskCancelled');
  contract.durable_event_migration_coupling.event_payload_schema_classification_count =
    contract.durable_event_migration_coupling.event_payload_schema_classifications.length;

  const errors = validateRuntimeSemanticProtocolContract(contract, readMap(), {
    repoRoot,
    contractPath: semanticContractPath,
    mapPath,
    skipRustGeneratedContractCheck: true
  });

  assert(errors.some((error) => error.includes('event_payload_schema_classifications must include TaskCancelled')));
});

test('rejects ledger payload descriptors that retain an any fallback', () => {
  const contract = readSemanticContract();
  const taskCancelled = contract.durable_event_migration_coupling.event_payload_schema_fingerprints.find(
    (entry) => entry.ledger_event_kind === 'TaskCancelled'
  );
  taskCancelled.payload_schema_descriptor = 'any{schema_contract:event-kind-versioned-payload}';

  const errors = validateRuntimeSemanticProtocolContract(contract, readMap(), {
    repoRoot,
    contractPath: semanticContractPath,
    mapPath,
    skipRustGeneratedContractCheck: true
  });

  assert(errors.some((error) => error.includes('payload schema descriptor must not use any fallback')));
});

test('rejects strict terminal payload descriptors without closed-field evidence requirements', () => {
  const contract = readSemanticContract();
  const taskCompleted = contract.durable_event_migration_coupling.event_payload_schema_fingerprints.find(
    (entry) => entry.ledger_event_kind === 'TaskCompleted'
  );
  taskCompleted.payload_schema_descriptor = taskCompleted.payload_schema_descriptor.replace(
    ';additional_fields:false',
    ''
  );

  const errors = validateRuntimeSemanticProtocolContract(contract, readMap(), {
    repoRoot,
    contractPath: semanticContractPath,
    mapPath,
    skipRustGeneratedContractCheck: true
  });

  assert(errors.some((error) => error.includes('reject additional fields')));
});

test('rejects full ledger payload closure claims while open payload classifications remain', () => {
  const contract = readSemanticContract();
  contract.durable_event_migration_coupling.ledger_payload_contract_scope.ledger_event_payload_typed_schema_coverage = 'closed';
  contract.durable_event_migration_coupling.release_blocking_open_payload_count = 0;

  const errors = validateRuntimeSemanticProtocolContract(contract, readMap(), {
    repoRoot,
    contractPath: semanticContractPath,
    mapPath,
    skipRustGeneratedContractCheck: true
  });

  assert(errors.some((error) => error.includes('full ledger payload typed schema coverage partial')));
  assert(errors.some((error) => error.includes('release_blocking_open_payload_count')));
});
