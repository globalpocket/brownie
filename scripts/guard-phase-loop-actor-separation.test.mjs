import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runPhaseLoopActorSeparationGuard
} from './guard-phase-loop-actor-separation.mjs';

const validPolicy = {
  schema_version: 1,
  policy_id: 'brownie-phase-loop-actor-separation-v1',
  repository: 'globalpocket/brownie',
  implementation_actor: 'brownie-agent',
  review_actor: 'globalpocket',
  merge_actor: 'globalpocket',
  requirements: [
    'Private local state must live under .brownie/private/.'
  ],
  forbidden_success_claims: [
    'Do not treat static review JSON as GitHub review provenance for a concrete implementation pull request.'
  ]
};

const validPackageJson = {
  scripts: {
    'phase-loop:implementation-preflight': 'node scripts/phase-loop-actor-preflight.mjs --role implementation',
    'phase-loop:review-preflight': 'node scripts/phase-loop-actor-preflight.mjs --role review',
    'guard:phase-loop-actor-separation': 'node scripts/guard-phase-loop-actor-separation.mjs',
    'guard:phase-loop-actor-separation:test': 'node --test scripts/guard-phase-loop-actor-separation.test.mjs'
  }
};

const validVsixPackageJson = {
  scripts: {
    check: 'pnpm --workspace-root guard:phase-loop-actor-separation && pnpm --workspace-root guard:phase-loop-actor-separation:test'
  }
};

function run(overrides = {}) {
  return runPhaseLoopActorSeparationGuard({
    policy: validPolicy,
    packageJson: validPackageJson,
    vsixPackageJson: validVsixPackageJson,
    gitignore: '.brownie/private/\n',
    createWindowsVm: "const p = '.brownie/private/vms/brownie-windows';",
    manageVmImages: "const p = '.brownie/private/vm-images';",
    bootstrapVms: "const p = '.brownie/private/';",
    ...overrides
  }).errors;
}

test('accepts actor separation and private boundary policy', () => {
  assert.deepEqual(run(), []);
});

test('rejects collapsed implementation and review actors', () => {
  const errors = run({
    policy: {
      ...validPolicy,
      implementation_actor: 'globalpocket'
    }
  });
  assert(errors.some((error) => error.includes('implementation_actor must be brownie-agent')));
  assert(errors.some((error) => error.includes('implementation_actor and review_actor must differ')));
});

test('rejects ignoring all of .brownie', () => {
  const errors = run({ gitignore: '.brownie/\n.brownie/private/\n' });
  assert(errors.some((error) => error.includes('must not ignore all of .brownie')));
});

test('rejects legacy VM private paths', () => {
  const errors = run({
    createWindowsVm: "const p = '.brownie/vms/brownie-windows';"
  });
  assert(errors.some((error) => error.includes('must use .brownie/private/')));
  assert(errors.some((error) => error.includes('legacy .brownie/vms')));
});

test('rejects missing package script wiring', () => {
  const errors = run({
    packageJson: {
      scripts: {}
    }
  });
  assert(errors.some((error) => error.includes('phase-loop:implementation-preflight')));
  assert(errors.some((error) => error.includes('guard:phase-loop-actor-separation')));
});
