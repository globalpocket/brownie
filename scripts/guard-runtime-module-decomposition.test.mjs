import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  collectRuntimeModuleMetrics,
  validateRuntimeModuleDecompositionAssessment,
} from './guard-runtime-module-decomposition.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function copyFixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-module-decomposition-'));
  for (const relativePath of [
    'docs/architecture/runtime-module-decomposition-assessment.json',
    'crates/brownie-runtime/src/lib.rs',
    'crates/brownie-runtime/src/task_progress.rs',
    'crates/brownie-runtime/src/controlled_tool_execution.rs',
    'crates/brownie-runtime/src/modepack.rs',
    'crates/brownie-runtime/src/product_completion.rs',
    'crates/brownie-runtime/src/product_continuation.rs',
    'crates/brownie-runtime/src/proposal_apply.rs',
    'crates/brownie-runtime/src/headless_continue.rs',
    'crates/brownie-runtime/src/headless_journey.rs',
    'crates/brownie-runtime/src/task_admission.rs',
    'crates/brownie-runtime/src/task_progress.rs',
    'crates/brownie-runtime/src/verification_recovery.rs',
    'crates/brownie-runtime/src/llm_provider.rs',
    'crates/brownie-runtime/src/codebase_index.rs',
    'crates/brownie-runtime/src/objective_proposal.rs',
    'crates/brownie-runtime/src/objective_verification.rs',
    'crates/brownie-runtime/src/mcp_client.rs',
  ]) {
    const target = path.join(temp, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, relativePath), target);
  }
  return temp;
}

test('repository runtime module decomposition assessment validates', () => {
  assert.doesNotThrow(() => validateRuntimeModuleDecompositionAssessment(repoRoot));
});

test('metrics collector records lib production and test split', () => {
  const metrics = collectRuntimeModuleMetrics(repoRoot);
  assert.ok(metrics['crates/brownie-runtime/src/lib.rs'].production_line_count > 1000);
  assert.ok(metrics['crates/brownie-runtime/src/lib.rs'].test_line_count > 1000);
});

test('task.list drifting back into lib.rs fails closed', () => {
  const temp = copyFixture();
  const libPath = path.join(temp, 'crates/brownie-runtime/src/lib.rs');
  fs.appendFileSync(libPath, '\nfn handle_task_list(_id: Value, _params: Option<Value>) {}\n');
  assert.throws(
    () => validateRuntimeModuleDecompositionAssessment(temp),
    /handle_task_list must remain outside lib.rs|line_count drifted/,
  );
});

test('missing task_progress ownership fails closed', () => {
  const temp = copyFixture();
  const taskProgressPath = path.join(temp, 'crates/brownie-runtime/src/task_progress.rs');
  const text = fs
    .readFileSync(taskProgressPath, 'utf8')
    .replace('pub(super) fn handle_task_list', 'fn handle_task_list_removed');
  fs.writeFileSync(taskProgressPath, text);
  assert.throws(
    () => validateRuntimeModuleDecompositionAssessment(temp),
    /task.list handler must be owned by task_progress|missing required token/,
  );
});

test('metric tampering fails closed', () => {
  const temp = copyFixture();
  const assessmentPath = path.join(temp, 'docs/architecture/runtime-module-decomposition-assessment.json');
  const assessment = JSON.parse(fs.readFileSync(assessmentPath, 'utf8'));
  assessment.metrics.files['crates/brownie-runtime/src/lib.rs'].production_line_count = 1;
  fs.writeFileSync(assessmentPath, JSON.stringify(assessment, null, 2) + '\n');
  assert.throws(
    () => validateRuntimeModuleDecompositionAssessment(temp),
    /production_line_count drifted/,
  );
});
