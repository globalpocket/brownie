#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const ASSESSMENT_PATH = 'docs/architecture/runtime-module-decomposition-assessment.json';
const LIB_PATH = 'crates/brownie-runtime/src/lib.rs';
const TASK_PROGRESS_PATH = 'crates/brownie-runtime/src/task_progress.rs';

const metricMatchers = {
  state_mutation_mentions:
    /append_task_event_with_payload|update_task_status|create_task|write_[a-z0-9_]*checkpoint|commit_[a-z0-9_]*snapshot/gi,
  durable_write_mentions:
    /append_task_event_with_payload|write_[a-z0-9_]*checkpoint|commit_[a-z0-9_]*snapshot|store\\.tasks\\(\\)\\.(?:create|update|append)/gi,
  permission_decision_mentions:
    /RuntimePermissionGate|PermissionDecision|permission[_\\.][a-z0-9_]+|workspace_write|mcp_tool_access/gi,
  recovery_mentions: /recovery|Recovery/gi,
  rpc_dispatch_mentions: /const METHOD_[A-Z0-9_]+|METHOD_[A-Z0-9_]+\\s*=>/g,
  approval_mentions: /approval|Approval/gi,
  mcp_mentions: /mcp|Mcp|MCP/gi,
  product_dod_mentions: /Product|product_completion|TechnicalDebt|completion_gate/gi,
  diagnostics_mentions: /diagnostic|Diagnostic/gi,
};

function readText(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function countMatches(text, regex) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function productionLineCount(relativePath, text) {
  if (relativePath !== LIB_PATH) {
    return null;
  }
  const lines = text.split('\n');
  const testStartIndex = lines.findIndex((line) => /^mod tests \{/.test(line));
  if (testStartIndex === -1) {
    throw new Error(`${LIB_PATH}: missing test module boundary`);
  }
  return testStartIndex;
}

export function collectRuntimeModuleMetrics(root = REPO_ROOT, sourcePaths = null) {
  const paths = sourcePaths ?? [
    LIB_PATH,
    'crates/brownie-runtime/src/codebase_index.rs',
    'crates/brownie-runtime/src/controlled_tool_execution.rs',
    'crates/brownie-runtime/src/headless_continue.rs',
    'crates/brownie-runtime/src/headless_journey.rs',
    'crates/brownie-runtime/src/llm_provider.rs',
    'crates/brownie-runtime/src/mcp_client.rs',
    'crates/brownie-runtime/src/modepack.rs',
    'crates/brownie-runtime/src/objective_proposal.rs',
    'crates/brownie-runtime/src/objective_verification.rs',
    'crates/brownie-runtime/src/product_completion.rs',
    'crates/brownie-runtime/src/product_continuation.rs',
    'crates/brownie-runtime/src/proposal_apply.rs',
    'crates/brownie-runtime/src/task_admission.rs',
    TASK_PROGRESS_PATH,
    'crates/brownie-runtime/src/verification_recovery.rs',
  ];
  const metrics = {};
  for (const relativePath of paths) {
    const text = readText(root, relativePath);
    const lines = text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
    const entry = {
      line_count: lines,
      public_items: countMatches(text, /^pub(?:\([^)]+\))?\s+(?:fn|struct|enum|trait|const|type|mod)\s/gm),
      private_items: countMatches(text, /^(?:fn|struct|enum|trait|const|type|mod)\s/gm),
    };
    const productionLines = productionLineCount(relativePath, text);
    if (productionLines !== null) {
      entry.production_line_count = productionLines;
      entry.test_line_count = lines - productionLines;
    }
    for (const [metric, matcher] of Object.entries(metricMatchers)) {
      entry[metric] = countMatches(text, matcher);
    }
    metrics[relativePath] = entry;
  }
  return metrics;
}

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function assertTokens(text, tokens, owner, errors) {
  for (const token of tokens ?? []) {
    assert(text.includes(token), `${owner}: missing required token ${JSON.stringify(token)}`, errors);
  }
}

function assertAbsentTokens(text, tokens, owner, errors) {
  for (const token of tokens ?? []) {
    assert(!text.includes(token), `${owner}: forbidden token still present ${JSON.stringify(token)}`, errors);
  }
}

export function validateRuntimeModuleDecompositionAssessment(root = REPO_ROOT) {
  const assessment = JSON.parse(readText(root, ASSESSMENT_PATH));
  const errors = [];
  assert(assessment.schema_version === 1, 'assessment schema_version must be 1', errors);
  assert(assessment.phase === 'RRP-6', 'assessment phase must be RRP-6', errors);
  assert(
    assessment.runtime_release_debt_id === 'runtime-module-decomposition-reevaluation',
    'assessment must target runtime-module-decomposition-reevaluation',
    errors,
  );
  assert(assessment.runtime_release_ready === false, 'assessment must keep runtime_release_ready false', errors);
  assert(
    assessment.closure?.debt_classification === 'closed',
    'module decomposition reevaluation closure must be explicit',
    errors,
  );
  assert(
    assessment.closure?.runtime_authority_retained_by === 'Rust Runtime',
    'closure must retain Rust Runtime authority',
    errors,
  );

  const sourcePaths = assessment.source_paths ?? [];
  assert(sourcePaths.includes(LIB_PATH), `source_paths must include ${LIB_PATH}`, errors);
  assert(sourcePaths.includes(TASK_PROGRESS_PATH), `source_paths must include ${TASK_PROGRESS_PATH}`, errors);
  for (const sourcePath of sourcePaths) {
    assert(fs.existsSync(path.join(root, sourcePath)), `source path missing: ${sourcePath}`, errors);
  }

  const actualMetrics = collectRuntimeModuleMetrics(root, sourcePaths);
  const expectedMetrics = assessment.metrics?.files ?? {};
  for (const [sourcePath, actual] of Object.entries(actualMetrics)) {
    const expected = expectedMetrics[sourcePath];
    assert(expected, `assessment metrics missing for ${sourcePath}`, errors);
    if (!expected) {
      continue;
    }
    for (const [metric, value] of Object.entries(actual)) {
      assert(
        expected[metric] === value,
        `${sourcePath}: ${metric} drifted, expected ${expected[metric]}, got ${value}`,
        errors,
      );
    }
  }

  const libMetrics = actualMetrics[LIB_PATH];
  const thresholds = assessment.thresholds ?? {};
  assert(
    libMetrics.production_line_count <= thresholds.lib_rs_production_line_ceiling,
    `${LIB_PATH}: production lines ${libMetrics.production_line_count} exceed ceiling ${thresholds.lib_rs_production_line_ceiling}`,
    errors,
  );
  assert(
    libMetrics.test_line_count <= thresholds.lib_rs_test_line_ceiling,
    `${LIB_PATH}: test lines ${libMetrics.test_line_count} exceed ceiling ${thresholds.lib_rs_test_line_ceiling}`,
    errors,
  );

  const libText = readText(root, LIB_PATH);
  const taskProgressText = readText(root, TASK_PROGRESS_PATH);
  assert(
    !/^fn handle_task_list\(/m.test(libText),
    `${LIB_PATH}: handle_task_list must remain outside lib.rs`,
    errors,
  );
  assert(
    /^pub\(super\) fn handle_task_list\(/m.test(taskProgressText),
    `${TASK_PROGRESS_PATH}: task.list handler must be owned by task_progress`,
    errors,
  );

  for (const boundary of assessment.module_boundaries ?? []) {
    const text = readText(root, boundary.source_path);
    assertTokens(text, boundary.required_tokens, `boundary ${boundary.id}`, errors);
    if (boundary.forbidden_tokens_in_lib_rs) {
      assertAbsentTokens(libText, boundary.forbidden_tokens_in_lib_rs, `boundary ${boundary.id}`, errors);
    }
  }

  const nonAuthority = assessment.non_authority_rules ?? [];
  for (const rule of [
    'CLI and VSIX are transport/projection only',
    'module extraction cannot move Runtime permission authority out of Rust Runtime',
    'runtime_release_ready remains false until remaining blockers and owner decisions close',
    'raw prompt/provider response/file content/absolute path/canonical path/secret/environment values/process output are not decomposition evidence',
  ]) {
    assert(nonAuthority.includes(rule), `missing non-authority rule: ${rule}`, errors);
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
  return { assessment, metrics: actualMetrics };
}

export function runRuntimeModuleDecompositionGuard() {
  validateRuntimeModuleDecompositionAssessment(REPO_ROOT);
  console.log('runtime module decomposition assessment guard passed');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runRuntimeModuleDecompositionGuard();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
