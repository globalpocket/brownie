import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTaskConstraints } from './phase-loop-task-constraints.mjs';

const prompt = (todo, prefix = '') => `${prefix}\n## Selected TODO\n\n${todo}\n\n## TODO Queue Snapshot\n- [ ] other: Patch only \`outside.txt\`: Unselected.\n`;
test('compiles every declared target without admitting queue snapshot paths', () => {
  const result = compileTaskConstraints(prompt('- [ ] independent: Patch only `notes.txt`, `src/app.rs`: Update output.'));
  assert.deepEqual(result.write_paths, ['notes.txt', 'src/app.rs']);
  assert.deepEqual(result.read_paths, result.write_paths);
  assert.deepEqual(result.write_operations, ['patch_file']);
  assert.deepEqual(result.denied_write_paths, ['.brownie/todo.md']);
  assert.equal(result.max_workspace_reads, 2);
  assert.equal(result.requires_workspace_write_proposal, true);
});
test('create and explicit saved-context repair forbid reads', () => {
  assert.equal(compileTaskConstraints(prompt('- [ ] create: Create only `new.txt`: Add result.')).max_workspace_reads, 0);
  const result = compileTaskConstraints(prompt('- [ ] repair: Patch only `notes.txt`: Repair.', '- leaf_required_next_tool_policy: use saved context'));
  assert.deepEqual(result.read_paths, []);
  assert.equal(result.max_workspace_reads, 0);
});
test('repair read policies compile to bounded constraints without interpreting goals in Runtime', () => {
  const selected = '- [ ] repair: Patch only `src/app.rs`, `notes.txt`: Repair.';
  for (const flag of ['leaf_required_next_tool_policy', 'leaf_oversized_repair_next_tool_policy', 'leaf_retry_required_next_tool']) {
    const policy = compileTaskConstraints(prompt(selected, `- ${flag}: next tool is workspace.write`));
    assert.deepEqual(policy.read_paths, [], flag);
    assert.equal(policy.max_workspace_reads, 0, flag);
  }
  const saved = '- read_budget_repair_policy: reuse saved preview\n- previous_workspace_read_preview_0: saved';
  assert.equal(compileTaskConstraints(prompt(selected, saved)).max_workspace_reads, 0);
  for (const flag of ['leaf_target_read_missing_repair_policy', 'stale_read_preview_policy', 'leaf_retry_read_first_policy', 'leaf_exact_context_reread_policy']) {
    const policy = compileTaskConstraints(prompt(selected, `${saved}\n- leaf_required_next_tool_policy: write\n- ${flag}: one exact target reread`));
    assert.deepEqual(policy.read_paths, ['src/app.rs', 'notes.txt'], flag);
    assert.equal(policy.max_workspace_reads, 1, flag);
    assert.ok(!policy.read_paths.includes('outside.txt'));
    assert.deepEqual(policy.write_paths, ['src/app.rs', 'notes.txt']);
  }
  const create = compileTaskConstraints(prompt('- [ ] create: Create only `new.txt`: Add.', '- leaf_exact_context_reread_policy: reread'));
  assert.deepEqual(create.read_paths, []);
  assert.equal(create.max_workspace_reads, 0, 'repair hints cannot grant a read of a missing create target');
});
test('explicit denied reads remain denied inside an otherwise admitted target scope', () => {
  const result = compileTaskConstraints(prompt('- [ ] repair: Patch only `src/app.rs`, `notes.txt`: Repair.\n  Do not read `notes.txt`. Use saved context.'));
  assert.deepEqual(result.denied_read_paths, ['notes.txt']);
  assert.ok(result.write_paths.includes('notes.txt'), 'read denial does not alter the write authorization');
  assert.throws(() => compileTaskConstraints(prompt('- [ ] repair: Patch only `src/app.rs`: Repair.\n  Do not read `../outside`.')));
  const queue = compileTaskConstraints(prompt('- [ ] repair: Decompose parent.', '- leaf_required_next_tool_policy: write\n- read_budget_repair_policy: saved\n- previous_workspace_read_preview_0: saved'), { state: 'todo_queue_repair', queuePath: 'planning/tasks.md' });
  assert.deepEqual(queue.read_paths, ['planning/tasks.md']);
  assert.equal(queue.max_workspace_reads, 2);
});
test('queue decomposition is external policy with an explicit generic path constraint', () => {
  const result = compileTaskConstraints(prompt('- [ ] split: Decompose broad parent.'), { state: 'decompose_todo', queuePath: 'planning/tasks.md' });
  assert.deepEqual(result.write_paths, ['planning/tasks.md']);
  assert.deepEqual(result.write_operations, ['patch_file']);
});
test('ambiguous authority cannot silently become unrestricted execution', () => {
  for (const body of [
    '- [ ] broad: Implement everything.',
    '- [ ] mixed: Patch only `a.txt`, Create only `b.txt`: Change.',
    '- [ ] outside: Patch only `../outside`: Change.',
    '- [ ] absolute: Patch only `/tmp/outside`: Change.',
    '- [ ] glob: Patch only `src/*.rs`: Change.',
    '- [ ] conflict: Patch only `notes.txt`: Change.\n  Forbidden changes: `notes.txt`.',
  ]) assert.throws(() => compileTaskConstraints(prompt(body)));
  assert.throws(() => compileTaskConstraints('no selected TODO'));
  assert.throws(() => compileTaskConstraints(prompt('- [ ] x: Patch only `x`: Update.') + '\n## Selected TODO\n'));
  assert.throws(() => compileTaskConstraints(prompt('- [ ] x: Patch only `x`: Update.'), { state: 'unknown' }));
});

test('CLI binds prompt metadata and preserves output on stale source', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const { fileURLToPath } = await import('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-constraints-'));
  try {
    const selected = '- [ ] normal: Patch only `notes.txt`: Update.\n  Forbidden changes: `private.txt`.';
    const source = prompt('- [ ] normal: Patch only `notes.txt`: Update.');
    const input = path.join(dir, 'prompt.md');
    const metadata = path.join(dir, 'metadata.json');
    const output = path.join(dir, 'constraints.json');
    fs.writeFileSync(input, source);
    fs.writeFileSync(metadata, JSON.stringify({ bdk_state: 'verify_or_repair', prompt_sha256: createHash('sha256').update(source).digest('hex'), selected_todo_text: selected, selected_todo_sha256: createHash('sha256').update(selected).digest('hex') }));
    const argv = [fileURLToPath(new URL('./phase-loop-task-constraints.mjs', import.meta.url)), input, metadata, output];
    assert.equal(spawnSync(process.execPath, argv).status, 0);
    const before = fs.readFileSync(output, 'utf8');
    assert.deepEqual(JSON.parse(before).write_paths, ['notes.txt']);
    assert.ok(JSON.parse(before).denied_write_paths.includes('private.txt'), 'full TODO prohibition survives prompt truncation');
    fs.appendFileSync(input, 'changed');
    assert.notEqual(spawnSync(process.execPath, argv).status, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), before);
    assert.equal(fs.readdirSync(dir).some((name) => name.endsWith('.tmp')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Migrated project policy cases formerly evaluated inside Runtime.
const migratedReadGoals = {
  "patch_only_todo_rejects_unrelated_workspace_read": "# Brownie Phase Loop Effective Prompt\n\n## Selected TODO\n\n- [ ] E-16a-fixture-objective: Make the Golden Journey fixture request a deterministic workspace mutation:\n  Patch only `scripts/release-runtime-operational-evidence.mjs`. Do not read\n  or patch `scripts/release-gate.mjs`.\n",
  "patch_only_todo_allows_each_multiple_target_workspace_read": "# Brownie Phase Loop Effective Prompt\n\n## Selected TODO\n\n- [ ] E-16f-release-contract-audit-sync: Patch only `docs/architecture/runtime-release-contract.json` and `docs/architecture/runtime-release-readiness-audit.json` to reflect current executable evidence:\n  Route: documentation.\n",
  "repair_feedback_preview_disables_initial_workspace_read": "# Brownie Phase Loop Effective Prompt\n\n## Previous Repair Feedback\n\n- read_budget_repair_policy: previous workspace.read content is embedded below; do not emit workspace.read in this invocation.\n- previous_workspace_read_preview_0: \"[workspace.read path=scripts/release-runtime-operational-evidence.mjs bytes_total=1 content_sha256=sha256:aaa]\\nconst x = 1;\"\n\n## Selected TODO\n\n- [ ] E-15d: Patch only `scripts/release-runtime-operational-evidence.mjs`.\n",
  "repair_feedback_can_read_todo_md_after_todo_decomposition_guard_failure": "# Brownie Phase Loop Effective Prompt\n\n## Previous Repair Feedback\n\n- read_budget_repair_policy: previous workspace.read content is embedded below; do not emit workspace.read in this invocation.\n- repair_reason: `todo_decomposition_guard_failed_after_todo_apply`\n- repair_hint: \"Repair `.brownie/todo.md` only: remove duplicate leaf ids.\"\n- previous_workspace_read_preview_0: \"[workspace.read path=scripts/release-runtime-operational-evidence.mjs bytes_total=1 content_sha256=sha256:aaa]\\nconst x = 1;\"\n\n## Selected TODO\n\n- [ ] E-15d-soak-section-collector: Patch only `scripts/release-runtime-operational-evidence.mjs`.\n"
};
test('migrated single-target read policy requires a bounded first-line contract', () => {
  assert.throws(() => compileTaskConstraints(migratedReadGoals.patch_only_todo_rejects_unrelated_workspace_read));
  const policy = compileTaskConstraints(prompt('- [ ] E-16a-fixture-objective: Patch only `scripts/release-runtime-operational-evidence.mjs`. Do not read or patch `scripts/release-gate.mjs`.'));
  assert.deepEqual(policy.read_paths, ['scripts/release-runtime-operational-evidence.mjs']);
  assert.ok(!policy.read_paths.includes('scripts/release-gate.mjs'));
});
test('migrated multiple-target read policy permits each selected target only', () => {
  const policy = compileTaskConstraints(migratedReadGoals.patch_only_todo_allows_each_multiple_target_workspace_read);
  assert.deepEqual(policy.read_paths, ['docs/architecture/runtime-release-contract.json', 'docs/architecture/runtime-release-readiness-audit.json']);
  assert.ok(!policy.read_paths.includes('docs/architecture/final-product-ready-judgment.md'));
});
test('migrated saved-preview read policy forbids a redundant initial read', () => {
  const policy = compileTaskConstraints(migratedReadGoals.repair_feedback_preview_disables_initial_workspace_read);
  assert.deepEqual(policy.read_paths, []);
  assert.equal(policy.max_workspace_reads, 0);
  assert.equal(compileTaskConstraints(prompt('- [ ] E-15d: Patch only `scripts/release-runtime-operational-evidence.mjs`.')).max_workspace_reads, 2);
});
test('migrated queue-repair read exception needs an explicit controller state', () => {
  const goal = migratedReadGoals.repair_feedback_can_read_todo_md_after_todo_decomposition_guard_failure;
  const ordinary = compileTaskConstraints(goal);
  assert.ok(!ordinary.read_paths.includes('.brownie/todo.md'));
  const repair = compileTaskConstraints(goal, { state: 'todo_queue_repair' });
  assert.deepEqual(repair.read_paths, ['.brownie/todo.md']);
  assert.ok(!repair.read_paths.includes('scripts/release-gate.mjs'));
});

// Original Runtime goal fixtures; project scope is now compiled externally.
const migratedWriteScopeCases = [
  {
    "name": "selected_todo_forbidden_changes_rejects_named_workspace_write_path",
    "goal": "# Brownie Phase Loop Effective Prompt\n\n## Selected TODO\n\n- [ ] E-16a-fixture-objective: Patch only `scripts/allowed.mjs`.\n  Forbidden changes: do not edit `scripts/forbidden.mjs`.\n",
    "denied": "scripts/forbidden.mjs",
    "allowed": "scripts/allowed.mjs"
  },
  {
    "name": "selected_todo_patch_only_rejects_unrelated_workspace_write_path",
    "goal": "# Brownie controller self-update recovery\n\n## Selected TODO\n\n- [ ] phase-loop-self-update: Patch only `scripts/phase-loop-self-update.mjs`.\n  Route: implementation.\n",
    "denied": "README.md",
    "allowed": "scripts/phase-loop-self-update.mjs"
  }
];
for (const fixture of migratedWriteScopeCases) {
  test(`external write scope: ${fixture.name}`, () => {
    const constraints = compileTaskConstraints(fixture.goal);
    assert.deepEqual(constraints.write_paths, [fixture.allowed]);
    assert.deepEqual(constraints.write_operations, ['patch_file']);
    assert.equal(constraints.write_paths.includes(fixture.denied), false);
    if (fixture.goal.includes('Forbidden changes:')) {
      assert.ok(constraints.denied_write_paths.includes(fixture.denied));
    }
  });
}
