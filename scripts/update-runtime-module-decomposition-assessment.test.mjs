import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildRuntimeModuleDecompositionAssessment,
  syncRuntimeModuleDecompositionAssessment
} from './update-runtime-module-decomposition-assessment.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assessmentRelativePath = 'docs/architecture/runtime-module-decomposition-assessment.json';
const libRelativePath = 'crates/brownie-runtime/src/lib.rs';

test('canonical generator keeps the production assessment metrics synchronized', () => {
  const assessment = JSON.parse(fs.readFileSync(path.join(repoRoot, assessmentRelativePath), 'utf8'));
  const expected = buildRuntimeModuleDecompositionAssessment(repoRoot);
  assert.deepEqual(assessment.metrics, expected.metrics);
  assert.equal(syncRuntimeModuleDecompositionAssessment(repoRoot, { check: true }).changed, false);
});

test('freshness check fails closed when runtime source drifts', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-module-assessment-'));
  const assessmentPath = path.join(temp, assessmentRelativePath);
  const libPath = path.join(temp, libRelativePath);
  fs.mkdirSync(path.dirname(assessmentPath), { recursive: true });
  fs.mkdirSync(path.dirname(libPath), { recursive: true });
  fs.writeFileSync(libPath, 'fn runtime_fixture() {}\nmod tests {\n}\n');
  fs.writeFileSync(assessmentPath, JSON.stringify({
    source_paths: [libRelativePath],
    metrics: { files: {} }
  }, null, 2) + '\n');

  assert.throws(
    () => syncRuntimeModuleDecompositionAssessment(temp, { check: true }),
    /runtime-module-decomposition-assessment\.json is stale/
  );
  assert.equal(syncRuntimeModuleDecompositionAssessment(temp).changed, true);
  fs.appendFileSync(libPath, 'fn changed_fixture() {}\n');
  assert.throws(
    () => syncRuntimeModuleDecompositionAssessment(temp, { check: true }),
    /runtime-module-decomposition-assessment\.json is stale/
  );
});

test('CI checks module assessment freshness before Rust setup in every cargo job', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const jobs = [
    ['check', 'runtime-platform'],
    ['runtime-platform', 'index-platform'],
    ['index-platform', null]
  ];
  for (const [job, nextJob] of jobs) {
    const start = workflow.indexOf(`  ${job}:`);
    const end = nextJob ? workflow.indexOf(`\n  ${nextJob}:`, start) : workflow.length;
    const section = workflow.slice(start, end);
    const freshness = section.indexOf('node scripts/update-runtime-module-decomposition-assessment.mjs --check');
    const rustSetup = section.indexOf('name: Setup Rust');
    assert(start >= 0 && end > start && freshness >= 0 && freshness < rustSetup, `${job} must fail fast before Rust setup`);
  }
});
