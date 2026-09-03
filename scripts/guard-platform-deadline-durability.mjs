#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const ASSESSMENT_PATH = 'docs/architecture/runtime-platform-deadline-durability-hardening.json';
const STORE_PATH = 'crates/brownie-store/src/lib.rs';
const MCP_CLIENT_PATH = 'crates/brownie-runtime/src/mcp_client.rs';
const RUNTIME_TEST_PATH = 'crates/brownie-runtime/src/lib.rs';

function readText(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(root, relativePath) {
  return JSON.parse(readText(root, relativePath));
}

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function extractFunction(text, name) {
  const start = text.search(new RegExp(`fn ${name}\\b`));
  if (start === -1) {
    return '';
  }
  const open = text.indexOf('{', start);
  if (open === -1) {
    return '';
  }
  const close = findMatchingBrace(text, open);
  if (close === -1) {
    return '';
  }
  return text.slice(start, close + 1);
}

export function validatePlatformDeadlineDurabilityHardening(root = REPO_ROOT) {
  const errors = [];
  const assessment = readJson(root, ASSESSMENT_PATH);
  const storeText = readText(root, STORE_PATH);
  const mcpClientText = readText(root, MCP_CLIENT_PATH);
  const runtimeTestText = readText(root, RUNTIME_TEST_PATH);

  assert(assessment.schema_version === 1, 'assessment schema_version must be 1', errors);
  assert(assessment.phase === 'RRP-7', 'assessment phase must be RRP-7', errors);
  assert(
    assessment.runtime_release_debt_id === 'platform-deadline-durability-hardening',
    'assessment must target platform-deadline-durability-hardening',
    errors,
  );
  assert(assessment.runtime_release_ready === false, 'assessment must keep runtime_release_ready false', errors);
  assert(
    assessment.closure?.debt_classification === 'closed',
    'platform/deadline/durability closure must be explicit',
    errors,
  );
  assert(
    assessment.closure?.runtime_authority_retained_by === 'Rust Runtime',
    'closure must retain Rust Runtime authority',
    errors,
  );
  assert(
    Array.isArray(assessment.non_goals) &&
      assessment.non_goals.includes('hosted scheduler, daemon, worker fleet, and generic shell execution remain out of scope'),
    'assessment must keep hosted scheduler/daemon/generic shell out of scope',
    errors,
  );

  const writeTaskState = extractFunction(storeText, 'write_task_state');
  assert(writeTaskState, `${STORE_PATH}: write_task_state must exist`, errors);
  assert(
    writeTaskState.includes('write_file_atomically(&state_path, state.as_bytes())'),
    `${STORE_PATH}: write_task_state must use the shared durable atomic helper`,
    errors,
  );
  assert(!/fs::write\s*\(/.test(writeTaskState), `${STORE_PATH}: write_task_state must not use raw fs::write`, errors);
  assert(!/fs::rename\s*\(/.test(writeTaskState), `${STORE_PATH}: write_task_state must not hand-roll rename durability`, errors);

  const writeFileAtomically = extractFunction(storeText, 'write_file_atomically');
  assert(writeFileAtomically, `${STORE_PATH}: write_file_atomically must exist`, errors);
  for (const token of [
    '.create_new(true)',
    'file.write_all(body)',
    'file.sync_all()',
    'fs::rename(&tmp_path, path)',
    'sync_dir(parent)?',
  ]) {
    assert(writeFileAtomically.includes(token), `${STORE_PATH}: write_file_atomically missing ${token}`, errors);
  }
  assert(
    /fn sync_dir\(path: &std::path::Path\) -> Result<\(\)>/.test(storeText),
    `${STORE_PATH}: sync_dir must return Result<()> so parent sync failures fail closed`,
    errors,
  );
  assert(storeText.includes('#[cfg(unix)]\nfn sync_dir'), `${STORE_PATH}: sync_dir must document Unix directory fsync behavior`, errors);
  assert(storeText.includes('#[cfg(not(unix))]\nfn sync_dir'), `${STORE_PATH}: sync_dir must document non-Unix boundary behavior`, errors);

  for (const token of [
    'command.process_group(0);',
    'terminate_process_tree(&mut child)',
    'RecvTimeoutError::Timeout',
    'process_tree_kill_attempted=true',
    'process_tree_kill_succeeded={succeeded}',
    'process_tree_kill_reason={reason}',
  ]) {
    assert(mcpClientText.includes(token), `${MCP_CLIENT_PATH}: missing MCP timeout hardening token ${token}`, errors);
  }
  for (const testName of [
    'mcp_stdio_timeout_cleans_up_process_without_accumulating_children',
    'mcp_tool_timeout_after_approval_records_outcome_unknown_and_blocks_reuse',
  ]) {
    assert(runtimeTestText.includes(testName), `${RUNTIME_TEST_PATH}: missing timeout/recovery test ${testName}`, errors);
  }

  const sourceChecks = assessment.source_checks ?? [];
  for (const id of [
    'task-state-uses-synced-atomic-helper',
    'atomic-helper-fsyncs-file-and-parent-directory',
    'mcp-stdio-timeout-kills-process-tree',
    'runtime-timeout-tests-cover-cleanup-and-terminal-state',
  ]) {
    assert(sourceChecks.some((check) => check.id === id), `${ASSESSMENT_PATH}: missing source check ${id}`, errors);
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
  return { assessment };
}

export function runPlatformDeadlineDurabilityGuard() {
  validatePlatformDeadlineDurabilityHardening(REPO_ROOT);
  console.log('platform/deadline/durability hardening guard passed');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runPlatformDeadlineDurabilityGuard();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
