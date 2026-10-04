import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  runRuntimeOperationalEvidenceGuard,
  validateRuntimeOperationalEvidence
} from './guard-runtime-operational-evidence.mjs';
import {
  buildRuntimeOperationalEvidence,
  redactDelegatedResult
} from './release-runtime-operational-evidence.mjs';

const requiredSections = ['artifact_lifecycle', 'golden_journey_fixture', 'soak_test', 'executable_evidence_validation'];

const forbiddenGeneratedEvidencePatterns = [
  /\/Users\//,
  /\/home\//,
  /[A-Za-z]:\/Users\//,
  /brownie-linux/i,
  /EncodedCommand/i,
  /worktree/i,
  /"command"\s*:/,
  /"stdout"\s*:/,
  /"stderr"\s*:/
];

const blockerPlaceholderPatterns = [
  /blocker/i,
  /placeholder/i,
  /TODO.*evidence/i,
  /not.*implemented/i,
  /stub/i,
  /mock.*evidence/i
];

function generatedEvidenceForbiddenMatches(evidence) {
  const serialized = JSON.stringify(evidence);
  return forbiddenGeneratedEvidencePatterns
    .filter((pattern) => pattern.test(serialized))
    .map((pattern) => String(pattern));
}

const requiredStatefulSoakStepIds = [
  'task_state_transition',
  'ledger_workspace_consistency',
  'resume_replay_handling',
  'duplicate_side_effect_rejection',
  'process_loss_recovery',
  'finite_convergence',
  'evidence_chain_integrity',
  'artifact_lifecycle',
  'golden_journey_fixture',
  'soak_test',
  'executable_evidence_validation'
];

test('evidence_chain_integrity step is required for fail-closed evidence', () => {
  const evidence = validEvidence();
  evidence.sections.soak_test = { step_ids: requiredStatefulSoakStepIds.filter(id => id !== 'evidence_chain_integrity') };
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('evidence_chain_integrity')),
    'evidence_chain_integrity step must be present for fail-closed evidence');
});

test('evidence must not contain blocker placeholders', () => {
  const evidence = validEvidence();
  evidence.sections.artifact_lifecycle = { status: 'placeholder', blocker: 'TODO: implement evidence' };
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('blocker') || error.includes('placeholder')),
    'evidence must not contain blocker placeholders');
});

test('runtime operational evidence models release operation as executable fail-closed evidence', async (t) => {
  const evidence = await buildRuntimeOperationalEvidence({
    artifact_lifecycle: { status: 'executable', fail_closed: true },
    golden_journey_fixture: { executed: true },
    soak_test: { step_ids: requiredStatefulSoakStepIds }
  });
  const guardResult = await runRuntimeOperationalEvidenceGuard(evidence);
  assert.ok(guardResult.valid, 'guard should pass for valid executable evidence');
  assert.ok(guardResult.fail_closed === true, 'executable evidence must be fail-closed');
  const redacted = redactDelegatedResult(evidence);
  assert.ok(!generatedEvidenceForbiddenMatches(redacted).length, 'no forbidden patterns in redacted evidence');
});

test('fail-closed evidence requires explicit fail_closed_reasons when artifact lifecycle is not executable', () => {
  const evidence = validEvidence({
    artifact_lifecycle: { status: 'blocked', fail_closed: true },
    fail_closed_reasons: ['artifact_lifecycle:blocked']
  });
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert.deepEqual(errors, [], 'fail-closed evidence with explicit reasons should pass validation');
});

test('rejects non-fail-closed executable evidence', async (t) => {
  const evidence = await buildRuntimeOperationalEvidence({
    artifact_lifecycle: { status: 'executable', fail_closed: false },
    golden_journey_fixture: { executed: true },
    soak_test: { step_ids: requiredStatefulSoakStepIds }
  });
  const guardResult = await runRuntimeOperationalEvidenceGuard(evidence);
  assert.ok(!guardResult.valid, 'guard should reject non-fail-closed executable evidence');
  assert.ok(guardResult.errors.some((e) => e.includes('fail_closed')), 'error should mention fail_closed');
});

function validateStatefulSoakSteps(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return { valid: false, missing: requiredStatefulSoakStepIds, reason: 'evidence is not an object' };
  }
  const soakSection = evidence.soak_test;
  if (!soakSection || typeof soakSection !== 'object') {
    return { valid: false, missing: requiredStatefulSoakStepIds, reason: 'soak_test section missing' };
  }
  const stepIds = soakSection.step_ids || [];
  const missing = requiredStatefulSoakStepIds.filter((id) => !stepIds.includes(id));
  if (missing.length > 0) {
    return { valid: false, missing, reason: 'required stateful soak steps incomplete' };
  }
  return { valid: true, missing: [], reason: 'all stateful soak steps present' };
}

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

function commandSummary(overrides = {}) {
  return {
    command_summary: { kind: 'command_summary', word_count: 2, sha256: 'a'.repeat(64) },
    exit_code: 0,
    signal: null,
    passed: true,
    stdout_summary: { kind: 'process_output_summary', byte_length: 0, line_count: 0, sha256: 'b'.repeat(64) },
    stderr_summary: { kind: 'process_output_summary', byte_length: 0, line_count: 0, sha256: 'c'.repeat(64) },
    ...overrides
  };
}

function statefulSoakSteps(overrides = {}) {
  return requiredStatefulSoakStepIds.map((id) => ({
    id,
    status: 'satisfied',
    passed: true,
    evidence_summary: { kind: 'stateful_soak_step_summary', sha256: id.padEnd(64, id.at(0) ?? 'a').slice(0, 64) },
    ...overrides[id]
  }));
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
            commands: [commandSummary()]
          }
        ]
      }),
      golden_journey_fixture: section('satisfied', {
        commands: [commandSummary()],
        lifecycle_evidence: {
          json_present: true,
          proposal_preflight_observed: true,
          apply_observed: true,
          post_apply_verification_observed: true,
          workspace_mutation_observed: true,
          completion_observed: true
        }
      }),
      soak_test: section('satisfied', {
        iterations_requested: 100,
        iterations_completed: 100,
        failure_count: 0,
        failure_rate: 0,
        duplicate_side_effects_observed: false,
        unrecoverable_run_count: 0,
        commands: [commandSummary()],
        stateful_steps: statefulSoakSteps()
      }),
      executable_evidence_validation: section('satisfied', {
        fail_closed: true,
        validated_sections: [
          { id: 'artifact_lifecycle', status: 'satisfied', satisfied: true },
          { id: 'golden_journey_fixture', status: 'satisfied', satisfied: true },
          { id: 'soak_test', status: 'satisfied', satisfied: true }
        ],
        missing_executable_evidence: []
      })
    },
    ...overrides
  };
}

test('accepts satisfied runtime operational evidence', () => {
  const evidence = validEvidence();
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert.deepEqual(errors, []);
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

test('rejects satisfied golden journey without complete lifecycle evidence', () => {
  const evidence = validEvidence();
  evidence.sections.golden_journey_fixture.lifecycle_evidence.workspace_mutation_observed = false;
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('workspace_mutation_observed must be true')));
});

test('rejects release-ready claims', () => {
  const errors = validateRuntimeOperationalEvidence(validEvidence({ runtime_release_ready: true }));
  assert(errors.some((error) => error.includes('runtime_release_ready true')));
});

test('validates fail-closed evidence with golden journey artifacts', () => {
  const evidence = validEvidence({
    fail_closed_reasons: ['golden_journey_fixture:not_executed_missing_artifacts']
  });
  evidence.sections.golden_journey_fixture = section('not_executed_missing_artifacts', { commands: [] });
  evidence.sections.artifact_lifecycle = { status: 'executable', fail_closed: true };
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert.equal(errors.length, 0, 'fail-closed evidence with explicit reason should be valid');
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
        commands: [commandSummary({ exit_code: 1, passed: false })]
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

test('accepts fail-closed artifact lifecycle when local release target manifest is missing', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-operational-evidence-test-'));
  const evidence = buildRuntimeOperationalEvidence({
    repoRoot,
    iterations: 1,
    generatedAt: '2026-09-12T00:00:00.000Z'
  });
  evidence.sections.golden_journey_fixture = section('not_executed_missing_artifacts', { commands: [] });
  evidence.sections.soak_test = section('not_executed_missing_artifacts', {
    iterations_requested: 1,
    iterations_completed: 0,
    failure_count: 0,
    failure_rate: 1
  });
  evidence.fail_closed_reasons = [
    `artifact_lifecycle:${evidence.sections.artifact_lifecycle.status}`,
    'golden_journey_fixture:not_executed_missing_artifacts',
    'soak_test:not_executed_missing_artifacts',
    'executable_evidence_validation:not_executed'
  ];
  assert.equal(evidence.sections.artifact_lifecycle.local_release_targets_path, '.brownie/local-release-targets.json');
  assert.deepEqual(validateRuntimeOperationalEvidence(evidence), []);
});

test('collector keeps version-only soak fail-closed', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-operational-evidence-test-'));
  const cliPath = path.join(repoRoot, 'target/debug/brownie');
  fs.mkdirSync(path.dirname(cliPath), { recursive: true });
  fs.writeFileSync(cliPath, '#!/bin/sh\necho brownie 0.0.0\n');
  fs.chmodSync(cliPath, 0o755);
  const evidence = buildRuntimeOperationalEvidence({
    repoRoot,
    iterations: 2,
    generatedAt: '2026-09-12T00:00:00.000Z'
  });
  assert.equal(evidence.sections.soak_test.status, 'not_executed');
  assert.deepEqual(
    evidence.sections.soak_test.missing_stateful_steps,
    requiredStatefulSoakStepIds.filter((stepId) => stepId !== 'task_state_transition')
  );
  assert(evidence.fail_closed_reasons.includes('soak_test:not_executed'));
  assert.deepEqual(validateRuntimeOperationalEvidence(evidence), []);
});

test('collector generated evidence contains no forbidden local or raw process details', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-operational-evidence-test-'));
  const cliPath = path.join(repoRoot, 'target/debug/brownie');
  fs.mkdirSync(path.dirname(cliPath), { recursive: true });
  fs.writeFileSync(cliPath, '#!/bin/sh\necho brownie 0.0.0\n');
  fs.chmodSync(cliPath, 0o755);
  const evidence = buildRuntimeOperationalEvidence({
    repoRoot,
    iterations: 1,
    generatedAt: '2026-09-12T00:00:00.000Z'
  });
  assert.deepEqual(generatedEvidenceForbiddenMatches(evidence), []);
  assert.deepEqual(validateRuntimeOperationalEvidence(evidence), []);
});

test('collector source does not contain raw fixture output payloads', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts/release-runtime-operational-evidence.mjs'), 'utf8');
  assert(!source.includes('const artifactLifecycleEvidence = {'));
  assert(!source.includes('const soakEvidenceFixture = {'));
  assert(!source.includes('actual_output:'));
  assert(!source.includes("stdout: 'Runtime"));
  assert(!source.includes("stderr: ''"));
});

test('accepts fail-closed delegated target command failures', () => {
  const evidence = validEvidence({
    fail_closed_reasons: ['artifact_lifecycle:failed']
  });
  evidence.sections.artifact_lifecycle = section('failed', {
    local_release_targets_status: 'loaded',
    local_release_targets_path: '.brownie/local-release-targets.json',
    local_release_targets_errors: [],
    lifecycle_results: [],
    target_results: [
      {
        target: 'linux-x64',
        kind: 'ssh',
        host: '[redacted-host]',
        workspace: '[redacted-local-evidence]',
        shell: 'posix',
        status: 'blocked_external',
        passed: false,
        commands: [
          {
            exit_code: 255,
            passed: false,
            command_summary: { kind: 'command_summary', word_count: 8, sha256: 'd'.repeat(64) },
            stdout_summary: { kind: 'process_output_summary', byte_length: 0, line_count: 0, sha256: 'e'.repeat(64) },
            stderr_summary: { kind: 'process_output_summary', byte_length: 90, line_count: 1, sha256: 'f'.repeat(64) }
          }
        ]
      }
    ]
  });
  assert.deepEqual(validateRuntimeOperationalEvidence(evidence), []);
});

test('redacts successful delegated target JSON before evidence persistence', () => {
  const delegated = redactDelegatedResult({
    build: {
      command: 'pnpm --workspace-root release:local-artifacts:all',
      stdout: 'artifact written to /Users/example/brownie/dist/brownie',
      stderr: '',
      artifact_path: '/Users/example/brownie/dist/brownie'
    },
    host: 'brownie-linux',
    workspace: '/home/ubuntu/brownie-worktree'
  });
  const evidence = validEvidence({
    fail_closed_reasons: ['artifact_lifecycle:failed']
  });
  evidence.sections.artifact_lifecycle = section('failed', {
    local_release_targets_status: 'loaded',
    local_release_targets_path: '.brownie/local-release-targets.json',
    local_release_targets_errors: [],
    lifecycle_results: [],
    target_results: [
      {
        target: 'linux-x64',
        kind: 'ssh',
        host: '[redacted-host]',
        workspace: '[redacted-local-evidence]',
        shell: 'posix',
        status: 'delegated_artifact_build_completed',
        passed: true,
        delegated_result: delegated,
        commands: [commandSummary()]
      }
    ]
  });
  assert.deepEqual(generatedEvidenceForbiddenMatches(evidence), []);
  assert.deepEqual(validateRuntimeOperationalEvidence(evidence), []);
});

test('rejects satisfied soak evidence with failures', () => {
  const evidence = validEvidence();
  evidence.sections.soak_test.failure_count = 1;
  evidence.sections.soak_test.failure_rate = 0.01;
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('zero failures')));
});

test('rejects satisfied soak evidence without stateful steps', () => {
  const evidence = validEvidence();
  delete evidence.sections.soak_test.stateful_steps;
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('must include stateful_steps')), errors);
});

test('rejects satisfied soak evidence with missing stateful step', () => {
  const evidence = validEvidence();
  evidence.sections.soak_test.stateful_steps = evidence.sections.soak_test.stateful_steps.filter(
    (step) => step.id !== 'process_loss_recovery'
  );
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('process_loss_recovery')), errors);
});

test('rejects satisfied artifact lifecycle with failed command', () => {
  const evidence = validEvidence();
  evidence.sections.artifact_lifecycle.lifecycle_results[0].commands[0] = {
    exit_code: 1,
    passed: false,
    command_summary: { kind: 'command_summary', word_count: 2, sha256: 'a'.repeat(64) }
  };
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('must pass')));
});

test('rejects satisfied golden journey with failed command', () => {
  const evidence = validEvidence();
  evidence.sections.golden_journey_fixture.commands[0] = {
    exit_code: 1,
    passed: false,
    command_summary: { kind: 'command_summary', word_count: 3, sha256: 'a'.repeat(64) }
  };
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('must pass')));
});

test('rejects forbidden local and raw process evidence', () => {
  const evidence = validEvidence();
  evidence.sections.golden_journey_fixture.commands[0] = {
    command: '/Users/example/brownie --version',
    exit_code: 0,
    passed: true,
    stdout: 'raw output',
    stderr: 'raw error'
  };
  evidence.sections.artifact_lifecycle.target_results = [
    {
      target: 'linux-x64',
      kind: 'ssh',
      host: 'brownie-linux',
      workspace: '/home/ubuntu/brownie',
      status: 'blocked_external',
      passed: false,
      commands: []
    }
  ];
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('must not store raw process evidence')), errors);
  assert(errors.some((error) => error.includes('must not contain forbidden local evidence')), errors);
});
