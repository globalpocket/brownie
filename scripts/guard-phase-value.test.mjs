import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { detectChangedFiles, runPhaseValueGuard } from './guard-phase-value.mjs';

function validManifest(overrides = {}) {
  const questions = [
    'strategic_capabilities',
    'new_capability',
    'why_existing_functionality_is_insufficient',
    'product_gap_if_skipped',
    'non_duplicative',
    'no_new_rpc',
    'no_new_summary',
    'runtime_behavior_change',
    'headless_autonomous_contribution',
    'milestone_progress'
  ];

  return {
    schema_version: 1,
    phase: 'X1.1',
    current_milestone: 'test_milestone',
    target_capability: 'headless_autonomous_development',
    concrete_capability_transition: 'generic_guard_validation',
    forbidden_pattern: 'wrapper_only_without_runtime_value',
    project_objective_ref: 'docs/architecture/product-charter.md',
    strategic_capability_mapping: [
      {
        capability: 'headless_autonomous_development',
        relationship: 'Keeps unattended phase review tied to concrete capability value.'
      }
    ],
    phase_value_gate: {
      questions: questions.map((id) => ({ id, question: `${id}?` })),
      answers: Object.fromEntries(questions.map((id) => [id, `${id} answer.`]))
    },
    review_value_gate: {
      reject_when: ['The PR is wrapper-only.']
    },
    exit_criteria: ['The generic guard validates the current manifest.'],
    ...overrides
  };
}

function withTempRepo(callback) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'brownie-phase-value-'));
  try {
    mkdirSync(path.join(repoRoot, 'docs/architecture'), { recursive: true });
    callback(repoRoot);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

function writeManifest(repoRoot, manifest) {
  writeFileSync(
    path.join(repoRoot, 'docs/architecture/phase-value-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

test('validates a non-M5 current manifest without source-token hard-coding', () => {
  withTempRepo((repoRoot) => {
    writeManifest(repoRoot, validManifest({ phase: 'X7.2' }));
    const result = runPhaseValueGuard({ repoRoot, changedFiles: [] });
    assert.deepEqual(result.errors, []);
  });
});

test('requires explicit review metadata when guard engine files change', () => {
  withTempRepo((repoRoot) => {
    writeManifest(repoRoot, validManifest());
    const missingReview = runPhaseValueGuard({
      repoRoot,
      changedFiles: ['scripts/guard-phase-value.mjs']
    });
    assert(missingReview.errors.some((error) => error.includes('guard_engine_change_review.required')));

    writeManifest(
      repoRoot,
      validManifest({
        guard_engine_change_review: {
          required: true,
          strict_review_required: true,
          no_self_approval: true,
          review_intent: 'Exercise stricter review for guard engine changes.',
          changed_files: ['scripts/guard-phase-value.mjs']
        }
      })
    );
    const withReview = runPhaseValueGuard({
      repoRoot,
      changedFiles: ['scripts/guard-phase-value.mjs']
    });
    assert.deepEqual(withReview.errors, []);
  });
});

test('detects guard engine changes from GitHub Actions shallow pull request checkouts', () => {
  const calls = [];
  const execGit = (_file, args) => {
    calls.push(args);
    if (args[0] === 'diff' && args[2] === 'origin/main...HEAD') {
      throw new Error('no merge base');
    }
    if (args[0] === 'fetch') {
      return '';
    }
    if (args[0] === 'diff' && args[2] === 'origin/main' && args[3] === 'HEAD') {
      return 'scripts/guard-phase-value.mjs\n';
    }
    return '';
  };

  const changedFiles = detectChangedFiles({
    repoRoot: '/tmp/brownie-test',
    env: {
      GITHUB_ACTIONS: 'true',
      GITHUB_BASE_REF: 'main'
    },
    execGit
  });

  assert.deepEqual(changedFiles, ['scripts/guard-phase-value.mjs']);
  assert(calls.some((args) => args[0] === 'fetch' && args.includes('+refs/heads/main:refs/remotes/origin/main')));
  assert(calls.some((args) => args[0] === 'diff' && args[2] === 'origin/main' && args[3] === 'HEAD'));
});

test('requires every mandated phase value answer', () => {
  withTempRepo((repoRoot) => {
    const manifest = validManifest();
    delete manifest.phase_value_gate.answers.no_new_summary;
    writeManifest(repoRoot, manifest);
    const result = runPhaseValueGuard({ repoRoot, changedFiles: [] });
    assert(result.errors.some((error) => error.includes('answers.no_new_summary')));
  });
});
