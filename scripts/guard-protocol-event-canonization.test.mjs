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
