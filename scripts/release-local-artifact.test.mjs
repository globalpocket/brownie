import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPlanForTarget,
  releaseArtifactSmokeArgs
} from './release-local-artifact.mjs';

test('release artifact build contains the CLI and its Runtime companion', () => {
  const platform = process.platform === 'win32' ? 'win32' : process.platform;
  const arch = process.arch === 'x64' ? 'x64' : process.arch;
  const plan = buildPlanForTarget(`${platform}-${arch}`);
  assert.match(plan.sourceArtifact, /brownie(?:\.exe)?$/u);
  assert.match(plan.sourceRuntime, /brownie-runtime(?:\.exe)?$/u);
  assert(plan.buildArgs.includes('brownie-cli'));
  assert(plan.buildArgs.includes('brownie-runtime'));
});

test('release artifact smoke invokes only current CLI surfaces', () => {
  assert.deepEqual(releaseArtifactSmokeArgs, [
    ['--version'],
    ['help', 'run'],
    ['--json', 'status'],
    ['--json', 'mode', 'list'],
    ['help', 'resume']
  ]);
  const serialized = JSON.stringify(releaseArtifactSmokeArgs);
  assert.doesNotMatch(serialized, /task.*run|ledger.*generate|stop/u);
});
