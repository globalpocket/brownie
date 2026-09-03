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
