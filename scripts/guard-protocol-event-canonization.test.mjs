import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  runProtocolEventCanonizationGuard,
  validateRuntimeProtocolEventCanonicalMap
} from './guard-protocol-event-canonization.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const mapPath = 'docs/architecture/runtime-protocol-event-canonical-map.json';

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readMap() {
  return JSON.parse(read(mapPath));
}

test('validates the repository Runtime protocol/event canonical map', () => {
  assert.deepEqual(runProtocolEventCanonizationGuard({ repoRoot }).errors, []);
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
