import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { duplicateJsonKeys, validatePhaseLoopPreflight } from './phase-loop-preflight.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-phase-loop-preflight-'));
  fs.mkdirSync(path.join(repo, 'docs/architecture'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.brownie'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), '- [ ] E-1: Patch only `README.md`:\n  Route: documentation.\n  Verification: run `pnpm --workspace-root guard:release-contract`.\n');
  fs.writeFileSync(path.join(repo, 'docs/architecture/phase-value-manifest.json'), '{ "phase": "E-1" }\n');
  fs.writeFileSync(path.join(repo, 'docs/architecture/runtime-release-readiness-audit.json'), '{ "audited_main_commit": "1111111111111111111111111111111111111111", "runtime_release_ready": false }\n');
  const auditText = fs.readFileSync(path.join(repo, 'docs/architecture/runtime-release-readiness-audit.json'), 'utf8');
  const auditHash = `sha256:${createHash('sha256').update(auditText).digest('hex')}`;
  fs.writeFileSync(path.join(repo, 'docs/architecture/runtime-release-contract.json'), JSON.stringify({
    phase: 'RRP-8.7',
    commit_trace: {
      readiness_audit_content_sha256: auditHash
    }
  }, null, 2) + '\n');
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo });
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });
  return repo;
}

test('detects duplicate JSON keys outside JSON.parse visibility', () => {
  const duplicates = duplicateJsonKeys('{ "a": 1, "nested": { "b": 1, "b": 2 }, "a": 3 }', 'fixture.json');
  assert.equal(duplicates.length, 2);
  assert(duplicates.some((entry) => entry.key === 'a' && entry.object_path === '<root>'));
  assert(duplicates.some((entry) => entry.key === 'b' && entry.object_path === 'nested'));
});

test('rejects release contract readiness audit hash drift', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'docs/architecture/runtime-release-readiness-audit.json'), '{ "audited_main_commit": "1111111111111111111111111111111111111111", "runtime_release_ready": false, "runtime_release_ready": false }\n');
  const result = validatePhaseLoopPreflight({ repo, skipCommands: true });
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'json_duplicate_key'), JSON.stringify(result.errors));
  assert(result.errors.some((error) => error.code === 'readiness_audit_hash_mismatch'), JSON.stringify(result.errors));
});

test('rejects dirty delivery when only owner blocker remains', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), '- [ ] E-owner: Owner must provide release credentials:\n  Route: owner.\n  Verification: external owner handoff.\n');
  fs.writeFileSync(path.join(repo, 'README.md'), 'dirty\n');
  const result = validatePhaseLoopPreflight({ repo, skipCommands: true });
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'dirty_delivery_required'), JSON.stringify(result.errors));
});

test('accepts Brownie-managed state changes when only an owner blocker remains', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), '- [ ] E-owner: Owner must provide release credentials:\n  Route: owner.\n  Verification: external owner handoff.\n');
  fs.mkdirSync(path.join(repo, '.brownie/release-evidence'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.brownie/release-evidence/managed-state.json'), '{"generated":true}\n');
  const result = validatePhaseLoopPreflight({ repo, skipCommands: true });
  assert(!result.errors.some((error) => error.code === 'dirty_delivery_required'), JSON.stringify(result.errors));
});

test('accepts an absolute TODO path inside the repository', () => {
  const repo = makeRepo();
  const result = validatePhaseLoopPreflight({
    repo,
    todo: path.join(repo, '.brownie/todo.md'),
    skipCommands: true
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test('rejects a TODO path outside the repository', () => {
  const repo = makeRepo();
  const outsideTodo = path.join(os.tmpdir(), `brownie-outside-${Date.now()}.md`);
  fs.writeFileSync(outsideTodo, '- [ ] E-outside: Patch only `README.md`\n');
  const result = validatePhaseLoopPreflight({ repo, todo: outsideTodo, skipCommands: true });
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'required_file_outside_repository'), JSON.stringify(result.errors));
  fs.rmSync(outsideTodo);
});

test('rejects an in-repository TODO symlink that resolves outside the repository', () => {
  const repo = makeRepo();
  const outsideTodo = path.join(os.tmpdir(), `brownie-outside-link-${Date.now()}.md`);
  const linkedTodo = path.join(repo, '.brownie/todo-link.md');
  fs.writeFileSync(outsideTodo, '- [ ] E-outside: Patch only `README.md`\n');
  fs.symlinkSync(outsideTodo, linkedTodo);
  const result = validatePhaseLoopPreflight({ repo, todo: linkedTodo, skipCommands: true });
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'required_file_outside_repository'), JSON.stringify(result.errors));
  fs.rmSync(outsideTodo);
});

test('accepts a workspace TODO snapshot and records source, fingerprint, and queue CAS evidence', () => {
  const repo = makeRepo();
  const sourceTodo = path.join(os.tmpdir(), `brownie-snapshot-source-${Date.now()}.md`);
  const snapshotTodo = path.join(repo, '.brownie', 'todo-snapshot.md');
  const breakdown = path.join(repo, '.brownie', 'todo-breakdown.md');
  const todoText = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');
  fs.writeFileSync(sourceTodo, todoText);
  fs.writeFileSync(snapshotTodo, todoText);
  fs.writeFileSync(breakdown, '# snapshot breakdown\n');
  const result = validatePhaseLoopPreflight({
    repo,
    todo: snapshotTodo,
    breakdown,
    snapshotSource: sourceTodo,
    controllerFingerprint: `sha256:${'a'.repeat(64)}`,
    skipCommands: true
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.snapshot_audit.source_path, sourceTodo);
  assert.equal(result.snapshot_audit.snapshot_path, snapshotTodo);
  assert.equal(result.snapshot_audit.source_sha256, result.snapshot_audit.snapshot_sha256);
  assert.match(result.snapshot_audit.queue_cas, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(result.snapshot_audit.controller_source_fingerprint, `sha256:${'a'.repeat(64)}`);
  fs.rmSync(sourceTodo);
});

test('runs the TODO guard against the configured snapshot path and rejects malformed snapshot content', () => {
  const repo = makeRepo();
  fs.copyFileSync(path.join(repositoryRoot, 'package.json'), path.join(repo, 'package.json'));
  const snapshotTodo = path.join(repo, '.brownie', 'todo-snapshot.md');
  const breakdown = path.join(repo, '.brownie', 'todo-breakdown.md');
  fs.writeFileSync(snapshotTodo, 'const malformedSnapshot = true;\n');
  fs.writeFileSync(breakdown, '# snapshot breakdown\n');
  assert.throws(
    () => execFileSync('node', [
      path.join(repositoryRoot, 'scripts/guard-todo-decomposition.mjs'),
      '--todo', snapshotTodo,
      '--breakdown', breakdown
    ], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    /TODO decomposition guard failed/u
  );
  const preflight = fs.readFileSync(path.join(repositoryRoot, 'scripts/phase-loop-preflight.mjs'), 'utf8');
  assert.match(preflight, /guard-todo-decomposition\.mjs'\), '--repo', repoRoot, '--todo', todoPath, '--breakdown', breakdownPath/u);
  assert.match(preflight, /phase-loop-todo-queue-integrity\.mjs'\), '--repo', repoRoot, '--todo', todoPath, '--breakdown', breakdownPath/u);
});

test('snapshot audit rejection preserves claim, ledger, status, and runtime state', () => {
  const repo = makeRepo();
  const sourceTodo = path.join(os.tmpdir(), `brownie-snapshot-protected-${Date.now()}.md`);
  const snapshotTodo = path.join(repo, '.brownie', 'todo-snapshot.md');
  const breakdown = path.join(repo, '.brownie', 'todo-breakdown.md');
  const stateDir = path.join(repo, '.brownie', 'private', 'phase-loop');
  fs.mkdirSync(path.join(stateDir, 'todo-claims'), { recursive: true });
  fs.mkdirSync(path.join(stateDir, 'runs'), { recursive: true });
  const protectedFiles = [
    path.join(stateDir, 'todo-claims', 'current.json'),
    path.join(stateDir, 'status.json'),
    path.join(stateDir, 'task-ledger.jsonl'),
    path.join(stateDir, 'runs', 'runtime.bin')
  ];
  for (const file of protectedFiles) fs.writeFileSync(file, `protected:${path.basename(file)}\n`);
  const sourceText = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');
  fs.writeFileSync(sourceTodo, sourceText);
  fs.writeFileSync(snapshotTodo, `${sourceText}\nmalformed audited mutation\n`);
  fs.writeFileSync(breakdown, '# snapshot breakdown\n');
  const digestFiles = () => protectedFiles.map((file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  const before = digestFiles();
  const result = validatePhaseLoopPreflight({
    repo,
    todo: snapshotTodo,
    breakdown,
    snapshotSource: sourceTodo,
    snapshotAudit: path.join(repo, '.brownie', 'missing-snapshot-audit.json'),
    controllerFingerprint: `sha256:${'b'.repeat(64)}`,
    skipCommands: true
  });
  assert.equal(result.valid, false, JSON.stringify(result.errors));
  assert(result.errors.some((error) => error.code === 'todo_snapshot_mutation_audit_missing'), JSON.stringify(result.errors));
  assert.deepEqual(digestFiles(), before);
  fs.rmSync(sourceTodo);
});

test('runs required preflight commands from the controller root when the workspace has older scripts', () => {
  const repo = makeRepo();
  const workspaceScriptNames = [
    'guard-todo-decomposition.mjs',
    'phase-loop-todo-queue-integrity.mjs',
    'guard-release-contract.mjs',
    'guard-runtime-release-readiness.mjs'
  ];
  for (const name of workspaceScriptNames) {
    fs.writeFileSync(path.join(repo, 'scripts', name), 'process.exit(91);\n');
  }
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'old workspace control scripts'], { cwd: repo, stdio: 'ignore' });
  const controlPlaneRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-controller-root-'));
  fs.mkdirSync(path.join(controlPlaneRoot, 'scripts'), { recursive: true });
  for (const name of workspaceScriptNames) {
    fs.writeFileSync(path.join(controlPlaneRoot, 'scripts', name), '#!/usr/bin/env node\nprocess.exit(0);\n');
  }
  const result = validatePhaseLoopPreflight({ repo, controlPlaneRoot });
  assert.equal(result.valid, true, JSON.stringify(result, null, 2));
  assert.deepEqual(result.command_results.map((entry) => entry.exit_code), [0, 0, 0, 0]);
});

test('accepts sequential controller-owned completion mutations for multiple TODOs', () => {
  const repo = makeRepo();
  const sourceTodo = path.join(os.tmpdir(), `brownie-snapshot-multi-${Date.now()}.md`);
  const snapshotTodo = path.join(repo, '.brownie', 'todo-snapshot.md');
  const breakdown = path.join(repo, '.brownie', 'todo-breakdown.md');
  const first = '- [ ] E-first: Patch only `README.md`:\n  Route: documentation.\n  Verification: run `pnpm --workspace-root guard:release-contract`.\n';
  const second = '- [ ] E-second: Patch only `CHANGELOG.md`:\n  Route: documentation.\n  Verification: run `pnpm --workspace-root guard:release-contract`.\n';
  const third = '- [ ] E-third: Patch only `LICENSE`:\n  Route: documentation.\n  Verification: run `pnpm --workspace-root guard:release-contract`.\n';
  const sourceText = `${first}${second}${third}`;
  fs.writeFileSync(sourceTodo, sourceText);
  fs.writeFileSync(breakdown, '# snapshot breakdown\n');
  fs.writeFileSync(snapshotTodo, sourceText);
  const digest = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
  const queueCas = (todoText) => digest(`${digest(todoText)}\n${digest(fs.readFileSync(breakdown, 'utf8'))}`);
  const auditPath = path.join(repo, '.brownie', 'todo-snapshot-audit.json');
  const writeAudit = (snapshotText, generation, previousSnapshotText, removedTodo) => {
    fs.writeFileSync(snapshotTodo, snapshotText);
    fs.writeFileSync(auditPath, JSON.stringify({
      schema_version: 1,
      source_path: sourceTodo,
      source_base_sha256: digest(sourceText),
      source_sha256: digest(sourceText),
      snapshot_path: snapshotTodo,
      snapshot_sha256: digest(snapshotText),
      breakdown_path: breakdown,
      breakdown_sha256: digest(fs.readFileSync(breakdown, 'utf8')),
      queue_cas: queueCas(snapshotText),
      generation,
      mutation: {
        kind: 'completed_todo_removal',
        previous_snapshot_sha256: digest(previousSnapshotText),
        removed_todo_first_line: removedTodo
      }
    }, null, 2) + '\n');
  };
  let result = validatePhaseLoopPreflight({
    repo,
    todo: snapshotTodo,
    breakdown,
    snapshotSource: sourceTodo,
    snapshotAudit: auditPath,
    skipCommands: true
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.snapshot_audit.generation, 0);
  writeAudit(`${second}${third}`, 1, sourceText, first.split('\n')[0]);
  result = validatePhaseLoopPreflight({
    repo,
    todo: snapshotTodo,
    breakdown,
    snapshotSource: sourceTodo,
    snapshotAudit: auditPath,
    skipCommands: true
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.snapshot_audit.generation, 1);
  writeAudit(third, 2, `${second}${third}`, second.split('\n')[0]);
  result = validatePhaseLoopPreflight({
    repo,
    todo: snapshotTodo,
    breakdown,
    snapshotSource: sourceTodo,
    snapshotAudit: auditPath,
    skipCommands: true
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.snapshot_audit.generation, 2);
  fs.rmSync(sourceTodo);
});

test('rejects a workspace TODO snapshot whose source fingerprint changed', () => {
  const repo = makeRepo();
  const sourceTodo = path.join(os.tmpdir(), `brownie-snapshot-mismatch-${Date.now()}.md`);
  const snapshotTodo = path.join(repo, '.brownie', 'todo-snapshot.md');
  const breakdown = path.join(repo, '.brownie', 'todo-breakdown.md');
  fs.writeFileSync(sourceTodo, '- [ ] E-source: Patch only `README.md`\n');
  fs.copyFileSync(path.join(repo, '.brownie/todo.md'), snapshotTodo);
  fs.writeFileSync(breakdown, '# snapshot breakdown\n');
  const result = validatePhaseLoopPreflight({
    repo,
    todo: snapshotTodo,
    breakdown,
    snapshotSource: sourceTodo,
    skipCommands: true
  });
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'todo_snapshot_mutation_audit_missing'), JSON.stringify(result.errors));
  fs.rmSync(sourceTodo);
});

test('places the strict preflight boundary before claim rebaseline and forbids ledger/runtime continuation', () => {
  const controller = fs.readFileSync(path.join(repositoryRoot, 'phase-loop.sh'), 'utf8');
  const runOnce = controller.indexOf('_run_brownie_once()');
  const boundary = controller.indexOf('run_phase_loop_preflight "$run_stamp" "pre-claim-boundary"', runOnce);
  const rebaseline = controller.indexOf('phase_loop_rebaseline_stale_claim "$run_stamp"', runOnce);
  const restoreTransition = controller.indexOf('restore_terminal_failure_source_transition_obligation', boundary);
  assert.ok(boundary >= 0);
  assert.ok(boundary < rebaseline);
  assert.ok(boundary < restoreTransition);
  assert.match(controller, /phase_loop_preflight_boundary_failed=true claim_reuse=forbidden ledger_transition=forbidden runtime_start=forbidden/u);
  assert.ok(controller.includes('if [ "$stage" = "pre-claim-boundary" ]; then'));
  assert.ok(controller.indexOf('return 78', boundary) < rebaseline);
  assert.doesNotMatch(controller.slice(boundary, restoreTransition), /write_bdk_trajectory_event/u);
  const preflightFunction = controller.indexOf('run_phase_loop_preflight()');
  const auditFailure = controller.indexOf('if ! write_phase_loop_snapshot_audit "$run_stamp" "$output"; then', preflightFunction);
  assert.ok(auditFailure >= 0);
  assert.ok(auditFailure < rebaseline);
  const auditFailureReturn = controller.indexOf('      return 78', auditFailure);
  const auditFailureBoundary = controller.slice(auditFailure, auditFailureReturn);
  assert.match(auditFailureBoundary, /phase_loop_snapshot_audit_failed=true claim_reuse=forbidden ledger_transition=forbidden runtime_start=forbidden/u);
  assert.doesNotMatch(auditFailureBoundary, /phase_loop_rebaseline_stale_claim|write_bdk_trajectory_event|run_brownie_runtime/u);
});

test('bounded implementation leaves are not instructed to re-split their TODO on missing patch context', () => {
  const prompt = fs.readFileSync(path.join(repositoryRoot, 'phase-loop.md'), 'utf8');
  assert.match(prompt, /This is allowed only when the\s+selected TODO is not already a bounded leaf with explicit patch targets\./);
  assert.match(prompt, /bounded leaf with explicit patch targets, never rewrite `\.brownie\/todo\.md` to\s+create children solely because the visible context is insufficient\./);
  assert.match(prompt, /either emit one safe patch restricted\s+to those targets, or report a concrete external\/owner blocker/);
});

test('bounded leaf oversized recovery never redirects to the TODO queue', () => {
  const controller = fs.readFileSync(path.join(repositoryRoot, 'phase-loop.sh'), 'utf8');
  assert.match(controller, /oversized or truncated\. The next tool must be exactly one smaller complete `workspace\.write` patch_file/);
  assert.match(controller, /oversized bounded-leaf repair is active[\s\S]{0,260}do not write `\.brownie\/todo\.md`/);
  assert.doesNotMatch(controller, /leaf_oversized_repair_leaf_template/);
});

test('ordinary leaf repair keeps the direct-write path when target context is available', () => {
  const controller = fs.readFileSync(path.join(repositoryRoot, 'phase-loop.sh'), 'utf8');
  assert.match(controller, /or not leaf_has_oversized_repair/);
  assert.match(controller, /leaf_required_next_tool_policy: the next tool must be `workspace\.write`/);
});
