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
  workflow_responsibility: {
    brownie_phase_loop: {
      actor: 'brownie-agent',
      owns: [
        'read .brownie/todo.md and .brownie/todo-breakdown.md',
        'select and claim one TODO',
        'decompose broad TODOs into implementation leaves when needed',
        'implement the selected TODO',
        'run bounded verification',
        'commit tracked workspace changes',
        'push the implementation branch',
        'create the pull request'
      ],
      must_stop_after: 'pull_request_created',
      must_not: [
        'review its own pull request',
        'approve its own pull request',
        'merge pull requests',
        'relax branch protection',
        'use the globalpocket account for implementation, commit, push, or pull request creation'
      ]
    },
    codex_globalpocket: {
      actor: 'globalpocket',
      owns: [
        'review Brownie-created pull requests',
        'request changes when CI, evidence, policy, or implementation is insufficient',
        'approve pull requests when the review is satisfied and the repository policy allows approval',
        'merge pull requests after required checks and review policy are satisfied',
        'perform explicit temporary owner emergency branch-protection changes only when required and restore them immediately'
      ],
      must_not: [
        'perform Brownie TODO implementation work through the globalpocket account',
        'create Brownie implementation branches, commits, pushes, or pull requests for ordinary TODO execution',
        'count a globalpocket-authored implementation pull request as a brownie-agent implementation pull request'
      ]
    }
  },
  requirements: [
    'Private local state must live under .brownie/private/.'
  ],
  forbidden_success_claims: [
    'Do not treat a Codex/globalpocket commit, push, or pull request as Brownie phase-loop implementation work.',
    'Do not treat static review JSON as GitHub review provenance for a concrete implementation pull request.'
  ]
};

const validPackageJson = {
  scripts: {
    'phase-loop:implementation-preflight': 'node scripts/phase-loop-actor-preflight.mjs --role implementation',
    'phase-loop:review-preflight': 'node scripts/phase-loop-actor-preflight.mjs --role review',
    'phase-loop:merge-preflight': 'node scripts/phase-loop-actor-preflight.mjs --role merge',
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

test('rejects policy that lets Brownie review or merge its own PR', () => {
  const errors = run({
    policy: {
      ...validPolicy,
      workflow_responsibility: {
        ...validPolicy.workflow_responsibility,
        brownie_phase_loop: {
          ...validPolicy.workflow_responsibility.brownie_phase_loop,
          must_not: ['review its own pull request']
        }
      }
    }
  });
  assert(errors.some((error) => error.includes('approve its own pull request')));
  assert(errors.some((error) => error.includes('merge pull requests')));
});

test('rejects policy that lets globalpocket create Brownie implementation PRs', () => {
  const errors = run({
    policy: {
      ...validPolicy,
      workflow_responsibility: {
        ...validPolicy.workflow_responsibility,
        codex_globalpocket: {
          ...validPolicy.workflow_responsibility.codex_globalpocket,
          must_not: []
        }
      }
    }
  });
  assert(errors.some((error) => error.includes('create Brownie implementation branches')));
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
  assert(errors.some((error) => error.includes('phase-loop:merge-preflight')));
  assert(errors.some((error) => error.includes('guard:phase-loop-actor-separation')));
});
