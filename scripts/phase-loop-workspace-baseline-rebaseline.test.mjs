import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { rebaselineWorkspaceToApprovedBaseline } from './phase-loop-workspace-baseline-rebaseline.mjs';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function writeControllerManifest(root) {
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'phase-loop.sh'), '#!/usr/bin/env bash\nexit 0\n');
  fs.writeFileSync(path.join(root, 'scripts/phase-loop-controller-source-manifest.json'), `${JSON.stringify({
    schema_version: 1,
    controller_source_paths: ['phase-loop.sh']
  }, null, 2)}\n`);
}

function makeRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-workspace-rebaseline-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Brownie test']);
  git(root, ['config', 'user.email', 'brownie@example.invalid']);
  fs.writeFileSync(path.join(root, '.gitignore'), '.brownie/private/\nignored-local.txt\n');
  writeControllerManifest(root);
  fs.writeFileSync(path.join(root, 'README.md'), 'baseline\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'baseline']);
  git(root, ['branch', '-M', 'worker']);
  git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  return root;
}

function advanceApprovedBaseline(root, file = 'approved.txt') {
  const oldHead = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, file), 'approved baseline advance\n');
  git(root, ['add', '--force', file]);
  git(root, ['commit', '-qm', 'approved baseline advance']);
  const approvedHead = git(root, ['rev-parse', 'HEAD']);
  git(root, ['update-ref', 'refs/remotes/origin/main', approvedHead]);
  git(root, ['checkout', '-q', '-B', 'worker', oldHead]);
  return { oldHead, approvedHead };
}

function createTreeEquivalentDivergence(root) {
  const baseHead = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-qb', 'tree-equivalent-worker']);
  fs.writeFileSync(path.join(root, 'tree-equivalent.txt'), 'identical tracked content\n');
  git(root, ['add', 'tree-equivalent.txt']);
  git(root, ['commit', '-qm', 'worker content commit']);
  const workerHead = git(root, ['rev-parse', 'HEAD']);

  git(root, ['checkout', '-qB', 'approved', baseHead]);
  fs.writeFileSync(path.join(root, 'tree-equivalent.txt'), 'identical tracked content\n');
  git(root, ['add', 'tree-equivalent.txt']);
  git(root, ['commit', '-qm', 'approved squash-equivalent commit']);
  const approvedHead = git(root, ['rev-parse', 'HEAD']);
  git(root, ['update-ref', 'refs/remotes/origin/main', approvedHead]);
  git(root, ['checkout', '-q', 'tree-equivalent-worker']);
  return { workerHead, approvedHead };
}

function stateDir(root) {
  return path.join(root, '.brownie/private/phase-loop');
}

test('fast-forwards only a strict approved descendant and preserves unrelated dirty state', () => {
  const root = makeRepository();
  const { oldHead, approvedHead } = advanceApprovedBaseline(root);
  fs.writeFileSync(path.join(root, 'operator-notes.txt'), 'preserve this dirty file\n');

  const result = rebaselineWorkspaceToApprovedBaseline({
    repoRoot: root,
    stateDir: stateDir(root),
    runStamp: 'test-safe-fast-forward',
    refreshBaseline: false,
    now: () => new Date('2026-10-29T10:00:00.000Z')
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.rebaselined, true);
  assert.equal(result.workspace_head_before, oldHead);
  assert.equal(result.workspace_head_after, approvedHead);
  assert.equal(git(root, ['rev-parse', 'HEAD']), approvedHead);
  assert.equal(fs.readFileSync(path.join(root, 'operator-notes.txt'), 'utf8'), 'preserve this dirty file\n');
  assert.equal(git(root, ['status', '--porcelain']).trim(), '?? operator-notes.txt');
  const audit = JSON.parse(fs.readFileSync(result.audit_path, 'utf8'));
  assert.equal(audit.status, 'applied');
  assert.deepEqual(audit.dirty_paths_before, ['operator-notes.txt']);
  assert.deepEqual(audit.dirty_paths_after, ['operator-notes.txt']);
});

test('refuses a fast-forward that would touch an existing dirty path', () => {
  const root = makeRepository();
  const { oldHead } = advanceApprovedBaseline(root, 'shared.txt');
  fs.writeFileSync(path.join(root, 'shared.txt'), 'operator-local change\n');

  const result = rebaselineWorkspaceToApprovedBaseline({
    repoRoot: root,
    stateDir: stateDir(root),
    refreshBaseline: false
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'dirty_paths_overlap_approved_baseline_delta');
  assert.deepEqual(result.overlapping_dirty_paths, ['shared.txt']);
  assert.equal(git(root, ['rev-parse', 'HEAD']), oldHead);
  assert.equal(fs.readFileSync(path.join(root, 'shared.txt'), 'utf8'), 'operator-local change\n');
});

test('refuses a fast-forward that would overwrite an ignored local file', () => {
  const root = makeRepository();
  const { oldHead } = advanceApprovedBaseline(root, 'ignored-local.txt');
  fs.writeFileSync(path.join(root, 'ignored-local.txt'), 'operator-local ignored contents\n');

  const result = rebaselineWorkspaceToApprovedBaseline({
    repoRoot: root,
    stateDir: stateDir(root),
    refreshBaseline: false
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'git_fast_forward_failed');
  assert.equal(git(root, ['rev-parse', 'HEAD']), oldHead);
  assert.equal(fs.readFileSync(path.join(root, 'ignored-local.txt'), 'utf8'), 'operator-local ignored contents\n');
  const audit = JSON.parse(fs.readFileSync(result.audit_path, 'utf8'));
  assert.equal(audit.status, 'failed');
  assert.equal(audit.failure_reason, 'git_fast_forward_failed');
});

test('refuses a dirty controller source even when the approved delta is elsewhere', () => {
  const root = makeRepository();
  const { oldHead } = advanceApprovedBaseline(root, 'approved.txt');
  fs.writeFileSync(path.join(root, 'phase-loop.sh'), '#!/usr/bin/env bash\necho local\n');

  const result = rebaselineWorkspaceToApprovedBaseline({
    repoRoot: root,
    stateDir: stateDir(root),
    refreshBaseline: false
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'dirty_controller_source_refuses_rebaseline');
  assert.deepEqual(result.dirty_controller_paths, ['phase-loop.sh']);
  assert.equal(git(root, ['rev-parse', 'HEAD']), oldHead);
});

test('marks a phase-loop shell update for process reload after rebaseline', () => {
  const root = makeRepository();
  advanceApprovedBaseline(root, 'phase-loop.sh');

  const result = rebaselineWorkspaceToApprovedBaseline({
    repoRoot: root,
    stateDir: stateDir(root),
    refreshBaseline: false
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.rebaselined, true);
  assert.equal(result.controller_shell_reload_required, true);
  const audit = JSON.parse(fs.readFileSync(result.audit_path, 'utf8'));
  assert.equal(audit.controller_shell_source_changed, true);
});

test('refuses diverged history instead of merging or resetting it', () => {
  const root = makeRepository();
  advanceApprovedBaseline(root, 'approved.txt');
  fs.writeFileSync(path.join(root, 'worker.txt'), 'worker-only commit\n');
  git(root, ['add', 'worker.txt']);
  git(root, ['commit', '-qm', 'worker-only commit']);
  const workerHead = git(root, ['rev-parse', 'HEAD']);

  const result = rebaselineWorkspaceToApprovedBaseline({
    repoRoot: root,
    stateDir: stateDir(root),
    refreshBaseline: false
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'workspace_history_diverged_from_approved_baseline');
  assert.equal(git(root, ['rev-parse', 'HEAD']), workerHead);
});

test('audits a squash-equivalent divergent history without rewriting the branch or dirty workspace', () => {
  const root = makeRepository();
  const { workerHead, approvedHead } = createTreeEquivalentDivergence(root);
  fs.writeFileSync(path.join(root, 'operator-notes.txt'), 'preserve this dirty file\n');

  const result = rebaselineWorkspaceToApprovedBaseline({
    repoRoot: root,
    stateDir: stateDir(root),
    runStamp: 'test-tree-equivalence',
    refreshBaseline: false,
    now: () => new Date('2026-10-30T10:00:00.000Z')
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.rebaselined, false);
  assert.equal(result.history_reconciled, true);
  assert.equal(result.baseline_equivalent, true);
  assert.equal(result.reason, 'workspace_tree_equivalent_to_approved_baseline');
  assert.equal(result.workspace_head_before, workerHead);
  assert.equal(result.workspace_head_after, workerHead);
  assert.equal(result.baseline_commit, approvedHead);
  assert.equal(result.workspace_tree, result.baseline_tree);
  assert.equal(git(root, ['rev-parse', 'HEAD']), workerHead);
  assert.equal(fs.readFileSync(path.join(root, 'operator-notes.txt'), 'utf8'), 'preserve this dirty file\n');
  assert.equal(git(root, ['status', '--porcelain']).trim(), '?? operator-notes.txt');
  const audit = JSON.parse(fs.readFileSync(result.audit_path, 'utf8'));
  assert.equal(audit.status, 'applied_tree_equivalence');
  assert.equal(audit.reconciliation_mode, 'tree_equivalent_history');
  assert.equal(audit.workspace_tree, audit.baseline_tree);
  assert.equal(audit.workspace_head_before, workerHead);
  assert.equal(audit.workspace_head_after, workerHead);
  assert.equal(audit.dirty_status_fingerprint_before, audit.dirty_status_fingerprint_after);
});

test('refuses a tree-equivalent history when controller source is dirty', () => {
  const root = makeRepository();
  const { workerHead } = createTreeEquivalentDivergence(root);
  fs.writeFileSync(path.join(root, 'phase-loop.sh'), '#!/usr/bin/env bash\necho local override\n');

  const result = rebaselineWorkspaceToApprovedBaseline({
    repoRoot: root,
    stateDir: stateDir(root),
    refreshBaseline: false
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'dirty_controller_source_refuses_rebaseline');
  assert.deepEqual(result.dirty_controller_paths, ['phase-loop.sh']);
  assert.equal(git(root, ['rev-parse', 'HEAD']), workerHead);
});

test('is a no-op when the workspace already contains the approved baseline', () => {
  const root = makeRepository();
  const result = rebaselineWorkspaceToApprovedBaseline({
    repoRoot: root,
    stateDir: stateDir(root),
    refreshBaseline: false
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.rebaselined, false);
  assert.equal(result.reason, 'workspace_already_contains_approved_baseline');
});

test('controller invokes workspace rebaseline before its approved-baseline guard', () => {
  const controller = fs.readFileSync(new URL('../phase-loop.sh', import.meta.url), 'utf8');
  const rebaselineCall = controller.indexOf('phase_loop_rebaseline_workspace_to_approved_baseline "$run_stamp"');
  const baselineGuard = controller.indexOf('if ! phase_loop_require_approved_controller_baseline; then');
  assert(rebaselineCall >= 0, 'controller must invoke the workspace rebaseline helper');
  assert(baselineGuard >= 0, 'controller must keep the approved baseline guard');
  assert(rebaselineCall < baselineGuard, 'workspace rebaseline must precede the approved baseline guard');
});

test('controller reloads its process before using a fast-forwarded phase-loop shell source', () => {
  const controller = fs.readFileSync(new URL('../phase-loop.sh', import.meta.url), 'utf8');
  assert.match(controller, /controller_shell_reload_required/u);
  assert.match(controller, /phase_loop_reload_supervisor_source\(\)/u);
  assert.match(controller, /exec \/bin\/bash "\$ROOT_DIR\/phase-loop\.sh" supervise/u);
  assert.match(controller, /exec \/bin\/bash "\$ROOT_DIR\/phase-loop\.sh" run-once/u);
});

test('controller carries a requested reload in-band instead of returning it as errexit-sensitive failure', () => {
  const controller = fs.readFileSync(new URL('../phase-loop.sh', import.meta.url), 'utf8');
  const helperStart = controller.indexOf('phase_loop_rebaseline_workspace_to_approved_baseline() {');
  const helperEnd = controller.indexOf('\nphase_loop_restore_admission_backed_stale_claim()', helperStart);
  assert(helperStart >= 0 && helperEnd > helperStart, 'workspace rebaseline shell helper must remain extractable');
  const helper = controller.slice(helperStart, helperEnd);

  assert.match(
    controller,
    /^#!\/usr\/bin\/env bash\n[\s\S]*?^set \+e\nset -u$/mu,
    'the controller must explicitly keep nonzero results in its state machine instead of inheriting errexit'
  );
  assert.match(
    helper,
    /if output="\$\([\s\S]+?\)"; then\s+status=0\s+else\s+status=\$\?\s+fi/u,
    'the rebaseline result must be captured by its own conditional command substitution'
  );
  assert.doesNotMatch(
    helper,
    /^\s*set -e\s*$/mu,
    'the rebaseline helper must not leak errexit into the controller after capturing its child result'
  );
  assert.match(
    controller,
    /write_status "controller_reloading"[\s\S]+?"79"[\s\S]+?PHASE_LOOP_CONTROLLER_SHELL_RELOAD_REQUESTED=1[\s\S]+?return 0/u,
    'reload must be a durable status plus an in-band handoff request, not a nonzero shell return'
  );
  assert.doesNotMatch(controller, /\[ "\$run_once_status" -eq 79 \]/u, 'run-once must not rely on an errexit-sensitive reload exit code');
});

test('run-once releases ownership and execs the refreshed controller after an in-band reload request', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-controller-run-once-reload-'));
  const controllerRoot = path.join(sandbox, 'controller');
  const lockDir = path.join(sandbox, 'phase-loop.lock');
  const reloadProbe = path.join(sandbox, 'reload-probe');
  const statusProbe = path.join(sandbox, 'status-probe');
  const supervisorLog = path.join(sandbox, 'supervisor.log');
  fs.mkdirSync(controllerRoot, { recursive: true });
  fs.writeFileSync(
    path.join(controllerRoot, 'phase-loop.sh'),
    '#!/usr/bin/env bash\n[ "$1" = "run-once" ] || exit 91\n[ ! -d "$PHASE_LOOP_TEST_LOCK_DIR" ] || exit 92\nprintf "reloaded\\n" > "$PHASE_LOOP_RELOAD_PROBE"\n'
  );
  fs.chmodSync(path.join(controllerRoot, 'phase-loop.sh'), 0o755);

  const controller = fs.readFileSync(new URL('../phase-loop.sh', import.meta.url), 'utf8');
  const caseStart = controller.indexOf('  run-once)\n');
  const caseEnd = controller.indexOf('\n    ;;', caseStart);
  assert(caseStart >= 0 && caseEnd > caseStart, 'run-once dispatch body must remain extractable');
  const dispatchBody = controller.slice(caseStart + '  run-once)\n'.length, caseEnd);
  const harness = `
set +e
set -u
ROOT_DIR=${JSON.stringify(controllerRoot)}
LOCK_DIR=${JSON.stringify(lockDir)}
STOP_FILE=${JSON.stringify(path.join(sandbox, 'stop'))}
SUPERVISOR_LOG=${JSON.stringify(supervisorLog)}
PHASE_LOOP_TEST_LOCK_DIR=${JSON.stringify(lockDir)}
PHASE_LOOP_RELOAD_PROBE=${JSON.stringify(reloadProbe)}
PHASE_LOOP_STATUS_PROBE=${JSON.stringify(statusProbe)}
export PHASE_LOOP_TEST_LOCK_DIR PHASE_LOOP_RELOAD_PROBE
load_env() { :; }
phase_loop_require_operational_configuration() { return 0; }
acquire_lock() { mkdir -p "$LOCK_DIR"; }
phase_loop_release_supervisor_lock() { rmdir "$LOCK_DIR"; }
phase_loop_finalize_unexpected_exit() { :; }
write_status() { printf '%s\\n' "$*" >> "$PHASE_LOOP_STATUS_PROBE"; }
run_brownie_once() {
  set -e
  PHASE_LOOP_CONTROLLER_SHELL_RELOAD_REQUESTED=1
  return 0
}
run_once_dispatch() {
${dispatchBody}
}
run_once_dispatch
`;
  execFileSync('bash', ['-cu', harness], { encoding: 'utf8' });
  assert.equal(fs.readFileSync(reloadProbe, 'utf8'), 'reloaded\n');
  assert.equal(fs.existsSync(lockDir), false, 'reload exec must happen only after releasing the durable lock');
});

test('workspace rebaseline preserves an ambient errexit setting', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-controller-reload-errexit-'));
  const controllerRoot = path.join(sandbox, 'controller');
  const stateDir = path.join(sandbox, 'state');
  const fakeBin = path.join(sandbox, 'bin');
  fs.mkdirSync(path.join(controllerRoot, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(stateDir, 'logs'), { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(controllerRoot, 'scripts/phase-loop-workspace-baseline-rebaseline.mjs'), '// fixture\n');
  const fakeNode = path.join(fakeBin, 'node');
  fs.writeFileSync(fakeNode, '#!/usr/bin/env bash\nprintf \'%s\\n\' \'{"ok":true,"rebaselined":true,"controller_shell_reload_required":true}\'\n');
  fs.chmodSync(fakeNode, 0o755);

  const controller = fs.readFileSync(new URL('../phase-loop.sh', import.meta.url), 'utf8');
  const start = controller.indexOf('phase_loop_rebaseline_workspace_to_approved_baseline() {');
  const end = controller.indexOf('\nphase_loop_restore_admission_backed_stale_claim()', start);
  const helper = controller.slice(start, end);
  const output = execFileSync('bash', ['-ceu', `${helper}\nnow_utc() { printf \'2026-10-29T00:00:00Z\'; }\nphase_loop_rebaseline_workspace_to_approved_baseline test-run\ncase "$-" in *e*) printf \'errexit-preserved\\n\' ;; *) exit 1 ;; esac`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ROOT_DIR: controllerRoot,
      PHASE_LOOP_WORKSPACE_ROOT: controllerRoot,
      PHASE_LOOP_APPROVED_CONTROLLER_BASELINE: 'origin/main',
      STATE_DIR: stateDir,
      SUPERVISOR_LOG: path.join(stateDir, 'logs', 'supervisor.log'),
      PHASE_LOOP_CONTROLLER_SHELL_RELOAD_REQUIRED: '0',
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`
    }
  }).trim();
  assert.equal(output, 'errexit-preserved');
});

test('controller reload detection canonicalizes an aliased workspace root', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-controller-reload-alias-'));
  const controllerRoot = path.join(sandbox, 'controller');
  const stateDir = path.join(sandbox, 'state');
  const fakeBin = path.join(sandbox, 'bin');
  fs.mkdirSync(path.join(controllerRoot, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(stateDir, 'logs'), { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(controllerRoot, 'scripts/phase-loop-workspace-baseline-rebaseline.mjs'), '// fixture\n');
  const fakeNode = path.join(fakeBin, 'node');
  fs.writeFileSync(fakeNode, '#!/usr/bin/env bash\nprintf \'%s\\n\' \'{"ok":true,"rebaselined":true,"controller_shell_reload_required":true}\'\n');
  fs.chmodSync(fakeNode, 0o755);

  const controller = fs.readFileSync(new URL('../phase-loop.sh', import.meta.url), 'utf8');
  const start = controller.indexOf('phase_loop_rebaseline_workspace_to_approved_baseline() {');
  const end = controller.indexOf('\nphase_loop_restore_admission_backed_stale_claim()', start);
  assert(start >= 0 && end > start, 'workspace rebaseline shell helper must be extractable');
  const helper = controller.slice(start, end);
  const workspaceAlias = `${controllerRoot}${path.sep}..${path.sep}controller`;
  const output = execFileSync('bash', ['-ceu', `${helper}\nnow_utc() { printf \'2026-10-29T00:00:00Z\'; }\nphase_loop_rebaseline_workspace_to_approved_baseline test-run\nprintf \'%s\\n\' "$PHASE_LOOP_CONTROLLER_SHELL_RELOAD_REQUIRED"`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ROOT_DIR: controllerRoot,
      PHASE_LOOP_WORKSPACE_ROOT: workspaceAlias,
      PHASE_LOOP_APPROVED_CONTROLLER_BASELINE: 'origin/main',
      STATE_DIR: stateDir,
      SUPERVISOR_LOG: path.join(stateDir, 'logs', 'supervisor.log'),
      PHASE_LOOP_CONTROLLER_SHELL_RELOAD_REQUIRED: '0',
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`
    }
  }).trim();
  assert.equal(output, '1');
});
