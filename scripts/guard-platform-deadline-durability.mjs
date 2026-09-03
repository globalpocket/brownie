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
  assert(assessment.phase === 'RRP-7.1', 'assessment phase must be RRP-7.1', errors);
  assert(
    assessment.runtime_release_debt_id === 'platform-deadline-durability-hardening',
    'assessment must target platform-deadline-durability-hardening',
    errors,
  );
  assert(assessment.runtime_release_ready === false, 'assessment must keep runtime_release_ready false', errors);
  assert(
    assessment.closure?.status === 'partial',
    'platform/deadline/durability assessment must remain partial until non-Unix and Runtime-wide deadline gaps close',
    errors,
  );
  assert(
    assessment.closure?.debt_classification === 'required_before_release',
    'platform/deadline/durability broad blocker must remain required_before_release',
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
    'durable_write_failpoint_matches("disk_full_before_write")',
    'durable_write_failpoint_matches("truncated_state_before_rename")',
    'file.write_all(body)',
    'file.sync_all()',
    'durable_write_failpoint_matches("rename_denied_after_sync")',
    'fs::rename(&tmp_path, path)',
    'sync_dir(parent)?',
  ]) {
    assert(writeFileAtomically.includes(token), `${STORE_PATH}: write_file_atomically missing ${token}`, errors);
  }
  for (const token of [
    'thread_local!',
    'static DURABLE_WRITE_FAILPOINT',
    'fn set_durable_write_failpoint',
    'fn durable_write_failpoint_matches',
    'pub fn update_task_status_with_payload_checked',
    'RUN_TERMINAL_MUTATION_LOCK',
    'RUN_TERMINAL_TRANSITION_MARKER',
    'fn acquire_run_terminal_mutation_lock',
    'fn recover_terminal_transition_marker_for_run_locked',
    'fn write_terminal_transition_marker',
    'task terminal status race',
    'terminal transition marker',
  ]) {
    assert(storeText.includes(token), `${STORE_PATH}: missing durable failure/race evidence token ${token}`, errors);
  }
  assert(
    /fn sync_dir\(path: &std::path::Path\) -> Result<\(\)>/.test(storeText),
    `${STORE_PATH}: sync_dir must return Result<()> so parent sync failures fail closed`,
    errors,
  );
  assert(storeText.includes('#[cfg(unix)]\nfn sync_dir'), `${STORE_PATH}: sync_dir must document Unix directory fsync behavior`, errors);
  assert(storeText.includes('#[cfg(not(unix))]\nfn sync_dir'), `${STORE_PATH}: sync_dir must document non-Unix boundary behavior`, errors);

  for (const token of [
    'struct McpStdioDeadline',
    'fn remaining_or_zero',
    'wait_for_stdio_child_exit_or_timeout(&mut child, deadline)?',
    'rx.recv_timeout(deadline.remaining_or_zero())',
    'command.process_group(0);',
    'terminate_process_tree(&mut child)',
    'RecvTimeoutError::Timeout',
    'timeout_budget_ms={}',
    'process_tree_kill_attempted=true',
    'process_tree_kill_succeeded={succeeded}',
    'process_tree_kill_reason={reason}',
  ]) {
    assert(mcpClientText.includes(token), `${MCP_CLIENT_PATH}: missing MCP timeout hardening token ${token}`, errors);
  }
  for (const testName of [
    'mcp_stdio_timeout_cleans_up_process_without_accumulating_children',
    'mcp_stdio_deadline_reconstructs_remaining_monotonic_budget',
    'mcp_stdio_deadline_covers_child_exit_after_response_line',
    'mcp_tool_timeout_after_approval_records_outcome_unknown_and_blocks_reuse',
    'durable_write_failure_injection_disk_full_fails_closed_before_task_state',
    'durable_write_failure_injection_rename_denied_cleans_temporary_file',
    'durable_write_failure_injection_truncated_state_does_not_replace_existing_state',
    'task_terminal_status_race_fails_closed_before_late_completion_overwrites_cancel',
    'task_terminal_status_stale_same_terminal_replays_without_duplicate_event',
    'task_terminal_status_race_serialized_by_run_terminal_mutation_lock',
    'task_terminal_transition_process_loss_repairs_missing_terminal_ledger_event',
  ]) {
    const testSource = testName.startsWith('durable_write_') || testName.startsWith('task_terminal_')
      ? storeText
      : runtimeTestText + mcpClientText;
    assert(testSource.includes(testName), `source tree: missing timeout/durability/race test ${testName}`, errors);
  }

  const sourceChecks = assessment.source_checks ?? [];
  for (const id of [
    'task-state-uses-synced-atomic-helper',
    'atomic-helper-fsyncs-file-and-parent-directory',
    'run-ledger-append-fsyncs-file-and-parent-directory',
    'mcp-stdio-monotonic-budget-reconstruction',
    'late-child-exit-covered-by-deadline',
    'mcp-stdio-timeout-kills-process-tree',
    'runtime-timeout-tests-cover-cleanup-and-terminal-state',
    'task-terminal-mutation-serialized-by-run-lock',
    'terminal-transition-marker-recovers-state-ledger-gap',
    'durable-write-failure-injection',
    'cross-platform-gaps-remain-required-before-release',
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
