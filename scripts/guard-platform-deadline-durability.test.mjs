import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { validatePlatformDeadlineDurabilityHardening } from './guard-platform-deadline-durability.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function copyFixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-platform-durability-'));
  for (const relativePath of [
    'docs/architecture/runtime-platform-deadline-durability-hardening.json',
    'crates/brownie-store/src/lib.rs',
    'crates/brownie-runtime/src/mcp_client.rs',
    'crates/brownie-runtime/src/lib.rs',
  ]) {
    const target = path.join(temp, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, relativePath), target);
  }
  return temp;
}

test('repository platform/deadline/durability assessment validates', () => {
  assert.doesNotThrow(() => validatePlatformDeadlineDurabilityHardening(repoRoot));
});

test('task state raw write fails closed', () => {
  const temp = copyFixture();
  const storePath = path.join(temp, 'crates/brownie-store/src/lib.rs');
  const text = fs
    .readFileSync(storePath, 'utf8')
    .replace('write_file_atomically(&state_path, state.as_bytes())', 'fs::write(&state_path, state)');
  fs.writeFileSync(storePath, text);
  assert.throws(
    () => validatePlatformDeadlineDurabilityHardening(temp),
    /write_task_state must use the shared durable atomic helper|write_task_state must not use raw fs::write/,
  );
});

test('missing parent directory sync fails closed', () => {
  const temp = copyFixture();
  const storePath = path.join(temp, 'crates/brownie-store/src/lib.rs');
  const text = fs.readFileSync(storePath, 'utf8').replaceAll('sync_dir(parent)?;', 'sync_dir(parent);');
  fs.writeFileSync(storePath, text);
  assert.throws(
    () => validatePlatformDeadlineDurabilityHardening(temp),
    /write_file_atomically missing sync_dir\(parent\)\?|sync_dir must return Result/,
  );
});

test('dropping process-tree timeout evidence fails closed', () => {
  const temp = copyFixture();
  const mcpPath = path.join(temp, 'crates/brownie-runtime/src/mcp_client.rs');
  const text = fs.readFileSync(mcpPath, 'utf8').replace('command.process_group(0);', '');
  fs.writeFileSync(mcpPath, text);
  assert.throws(
    () => validatePlatformDeadlineDurabilityHardening(temp),
    /missing MCP timeout hardening token command\.process_group/,
  );
});

test('dropping MCP stdio monotonic deadline evidence fails closed', () => {
  const temp = copyFixture();
  const mcpPath = path.join(temp, 'crates/brownie-runtime/src/mcp_client.rs');
  const text = fs.readFileSync(mcpPath, 'utf8').replace('struct McpStdioDeadline', 'struct RemovedDeadline');
  fs.writeFileSync(mcpPath, text);
  assert.throws(
    () => validatePlatformDeadlineDurabilityHardening(temp),
    /missing MCP timeout hardening token struct McpStdioDeadline/,
  );
});

test('claiming broad platform closure fails closed', () => {
  const temp = copyFixture();
  const assessmentPath = path.join(temp, 'docs/architecture/runtime-platform-deadline-durability-hardening.json');
  const assessment = JSON.parse(fs.readFileSync(assessmentPath, 'utf8'));
  assessment.closure.status = 'implemented_sufficient';
  assessment.closure.debt_classification = 'closed';
  fs.writeFileSync(assessmentPath, JSON.stringify(assessment, null, 2) + '\n');
  assert.throws(
    () => validatePlatformDeadlineDurabilityHardening(temp),
    /must remain partial|must remain required_before_release/,
  );
});

test('dropping late child exit deadline test fails closed', () => {
  const temp = copyFixture();
  const mcpPath = path.join(temp, 'crates/brownie-runtime/src/mcp_client.rs');
  const text = fs
    .readFileSync(mcpPath, 'utf8')
    .replace('mcp_stdio_deadline_covers_child_exit_after_response_line', 'mcp_stdio_late_exit_removed');
  fs.writeFileSync(mcpPath, text);
  assert.throws(
    () => validatePlatformDeadlineDurabilityHardening(temp),
    /missing timeout\/durability\/race test mcp_stdio_deadline_covers_child_exit_after_response_line/,
  );
});

test('dropping durable write failure injection evidence fails closed', () => {
  const temp = copyFixture();
  const storePath = path.join(temp, 'crates/brownie-store/src/lib.rs');
  const text = fs.readFileSync(storePath, 'utf8').replaceAll('disk_full_before_write', 'disk_full_removed');
  fs.writeFileSync(storePath, text);
  assert.throws(
    () => validatePlatformDeadlineDurabilityHardening(temp),
    /write_file_atomically missing durable_write_failpoint_matches\("disk_full_before_write"\)|missing timeout\/durability\/race test durable_write_failure_injection_disk_full/,
  );
});

test('dropping checked terminal status update fails closed', () => {
  const temp = copyFixture();
  const storePath = path.join(temp, 'crates/brownie-store/src/lib.rs');
  const text = fs
    .readFileSync(storePath, 'utf8')
    .replace('pub fn update_task_status_with_payload_checked', 'pub fn update_task_status_with_payload_unchecked');
  fs.writeFileSync(storePath, text);
  assert.throws(
    () => validatePlatformDeadlineDurabilityHardening(temp),
    /missing durable failure\/race evidence token pub fn update_task_status_with_payload_checked/,
  );
});

test('dropping terminal mutation lock evidence fails closed', () => {
  const temp = copyFixture();
  const storePath = path.join(temp, 'crates/brownie-store/src/lib.rs');
  const text = fs
    .readFileSync(storePath, 'utf8')
    .replaceAll('RUN_TERMINAL_MUTATION_LOCK', 'RUN_TERMINAL_LOCK_REMOVED');
  fs.writeFileSync(storePath, text);
  assert.throws(
    () => validatePlatformDeadlineDurabilityHardening(temp),
    /missing durable failure\/race evidence token RUN_TERMINAL_MUTATION_LOCK/,
  );
});

test('dropping terminal transition process-loss test fails closed', () => {
  const temp = copyFixture();
  const storePath = path.join(temp, 'crates/brownie-store/src/lib.rs');
  const text = fs
    .readFileSync(storePath, 'utf8')
    .replace(
      'task_terminal_transition_process_loss_repairs_missing_terminal_ledger_event',
      'task_terminal_transition_process_loss_removed',
    );
  fs.writeFileSync(storePath, text);
  assert.throws(
    () => validatePlatformDeadlineDurabilityHardening(temp),
    /missing timeout\/durability\/race test task_terminal_transition_process_loss_repairs_missing_terminal_ledger_event/,
  );
});

test('assessment cannot claim Runtime Release Ready', () => {
  const temp = copyFixture();
  const assessmentPath = path.join(temp, 'docs/architecture/runtime-platform-deadline-durability-hardening.json');
  const assessment = JSON.parse(fs.readFileSync(assessmentPath, 'utf8'));
  assessment.runtime_release_ready = true;
  fs.writeFileSync(assessmentPath, JSON.stringify(assessment, null, 2) + '\n');
  assert.throws(
    () => validatePlatformDeadlineDurabilityHardening(temp),
    /runtime_release_ready false/,
  );
});
