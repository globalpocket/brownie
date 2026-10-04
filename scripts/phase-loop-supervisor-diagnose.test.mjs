import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { diagnosePhaseLoop, unexpectedNestedSuperviseDescendants } from './phase-loop-supervisor-diagnose.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-supervisor-diagnose-'));
  fs.mkdirSync(path.join(repo, '.brownie/private/phase-loop/todo-claims'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.brownie/private/phase-loop/runs'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs/architecture'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
    scripts: {
      'guard:release-gate': 'node scripts/release-gate.mjs --dry-run',
      'guard:todo-decomposition': 'node scripts/guard-todo-decomposition.mjs',
      'release:runtime-operational-evidence:test': 'node --test scripts/guard-runtime-operational-evidence.test.mjs'
    }
  }, null, 2));
  fs.writeFileSync(path.join(repo, 'scripts/release-gate.mjs'), 'export const ok = true;\n');
  fs.writeFileSync(path.join(repo, 'scripts/guard-runtime-operational-evidence.test.mjs'), 'export const ok = true;\n');
  fs.copyFileSync(
    path.join(__dirname, 'phase-loop-todo-queue-integrity.mjs'),
    path.join(repo, 'scripts/phase-loop-todo-queue-integrity.mjs')
  );
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'README.md'), 'test\n');
  execFileSync('git', ['add', 'README.md', 'package.json', 'scripts/release-gate.mjs', 'scripts/guard-runtime-operational-evidence.test.mjs', 'scripts/phase-loop-todo-queue-integrity.mjs'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });
  return repo;
}

function writeJson(repo, relativePath, value) {
  const file = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTodo(repo, text) {
  fs.mkdirSync(path.join(repo, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), text);
  const ids = [...text.matchAll(/^- \[ \] ([^:\n]+):/gmu)].map((match) => match[1]);
  const graph = ids.map((id) => `- ${id}: <none>`).join('\n');
  const ledger = ids.map((id) => `- ${id}: fixture verification`).join('\n');
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `# breakdown

Parent TODO: fixture

Dependency graph:
${graph}

Verification ledger:
${ledger}

Quality rubric:
${ledger}
`);
  execFileSync('git', ['add', '.brownie/todo.md', '.brownie/todo-breakdown.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'todo fixture'], { cwd: repo, stdio: 'ignore' });
}

const implementationTodo = `- [ ] E-20h-release-evidence-script: Patch only \`scripts/release-gate.mjs\` to add deterministic release evidence checks:
  Route: implementation.
  Source TODO: TODO-decompose-release-ops-blockers.
  Depends on: <none>.
  Completion condition: release-gate.mjs validates queue fingerprint matches claim state and rejects stale snapshots with clear error messages.
  Forbidden changes: do not modify phase-loop.sh or external controller files.
  Verification: run \`pnpm --workspace-root guard:release-gate\`.`;

const runtimeEvidenceTodo = `- [ ] E-21c-runtime-operational-evidence-impl-2-target-02: Patch only \`scripts/guard-runtime-operational-evidence.test.mjs\` to require runtime operational evidence to model release operation as executable fail-closed evidence:
  Route: implementation.
  Source TODO: E-21c-runtime-operational-evidence.
  Depends on: <none>.
  Completion condition: the runtime operational evidence guard test rejects non-executable evidence and accepts valid executable evidence without weakening the release evidence contract.
  Forbidden changes: do not remove assertions or weaken the guard/test contract.
  Verification: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`.`;

test('does not classify the normal direct supervise child as nested supervisor', () => {
  const descendants = [
    {
      pid: 101,
      ppid: 100,
      command: 'bash /repo/phase-loop.sh supervise'
    },
    {
      pid: 102,
      ppid: 101,
      command: '/repo/target/debug/brownie --json run --file prompt.md'
    }
  ];

  assert.deepEqual(unexpectedNestedSuperviseDescendants(descendants, 100), []);
});

test('classifies supervise below the direct worker wrapper as nested supervisor', () => {
  const descendants = [
    {
      pid: 101,
      ppid: 100,
      command: 'bash /repo/phase-loop.sh supervise'
    },
    {
      pid: 102,
      ppid: 101,
      command: 'bash /repo/phase-loop.sh supervise'
    }
  ];

  assert.deepEqual(unexpectedNestedSuperviseDescendants(descendants, 100), [descendants[1]]);
});

const externalBlockerTodo = `- [ ] E-20i-blocker-ops-external: Blocker: External release ops environment configuration must be provided by repository owner before Brownie can complete release engineering tasks.
  Route: release-ops.
  Source TODO: TODO-decompose-release-ops-blockers.
  Depends on: <none>.
  Completion condition: Owner provides CI/CD environment configuration or marks release ops as owner-only.
  Forbidden changes: do not invent evidence values or declare Product Ready.
  Verification: inspect/blocker/fail-closed - owner must provide environment configuration.`;

test('diagnoses explicit blocker selected for worker after no-progress', () => {
  const repo = makeRepo();
  writeTodo(repo, `${externalBlockerTodo}\n\n${implementationTodo}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-1',
    consecutive_failures: 3,
    detail: 'no eligible task'
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 3,
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      selected_todo: externalBlockerTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-1',
    selected_todo: externalBlockerTodo
  });

  const result = diagnosePhaseLoop({ repoRoot: repo, write: false, timestamp: '2026-10-02T00:00:00Z' });

  assert.equal(result.summary.should_notify, true);
  assert.equal(result.summary.next_action, 'cause_analysis_then_guard_or_queue_repair_before_worker_retry');
  assert(result.issues.some((issue) => issue.code === 'explicit_blocker_selected_for_worker'), result);
  assert(result.issues.some((issue) => issue.code === 'no_progress_observed'), result);
});

test('quietly accepts healthy running loop without actionable issues', () => {
  const repo = makeRepo();
  writeTodo(repo, `${implementationTodo}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'running',
    run_id: 'run-healthy',
    consecutive_failures: 0,
    detail: 'running'
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'progress',
    same_progress_count: 1,
    progress_projection: {
      cli_status: 'objective_proposal_applied',
      selected_todo: implementationTodo
    }
  });

  const result = diagnosePhaseLoop({ repoRoot: repo, write: false, timestamp: '2026-10-02T00:00:00Z' });

  assert.equal(result.summary.should_notify, false, JSON.stringify(result.issues));
  assert.equal(result.summary.next_action, 'silent_continue');
});

test('detects active claim that no longer matches the live queue selection', () => {
  const repo = makeRepo();
  writeTodo(repo, `${implementationTodo}\n\n${runtimeEvidenceTodo}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'running',
    run_id: 'run-stale-claim',
    consecutive_failures: 0,
    detail: 'running'
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'progress',
    same_progress_count: 0,
    progress_projection: {
      cli_status: 'objective_proposal_applied',
      selected_todo: implementationTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-stale',
    status: 'in_progress',
    selected_todo: runtimeEvidenceTodo
  });

  const result = diagnosePhaseLoop({ repoRoot: repo, write: false, timestamp: '2026-10-02T00:00:00Z' });

  assert.equal(result.summary.should_notify, true);
  assert(result.issues.some((issue) => issue.code === 'active_claim_not_selected_by_live_queue'), JSON.stringify(result));
});

test('detects stale no-progress projection while a newer run is marked running', () => {
  const repo = makeRepo();
  writeTodo(repo, `${runtimeEvidenceTodo}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'running',
    run_id: '20261003T042225Z',
    consecutive_failures: 0,
    detail: 'Brownie run started at 2026-10-03T04:22:25Z'
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 3,
    run_stamp: '20261003T042027Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      selected_todo: runtimeEvidenceTodo
    }
  });

  const result = diagnosePhaseLoop({ repoRoot: repo, write: false, timestamp: '2026-10-02T00:00:00Z' });

  assert.equal(result.summary.should_notify, true);
  assert.equal(result.summary.next_action, 'cause_analysis_then_guard_or_queue_repair_before_worker_retry');
  assert(result.issues.some((issue) => issue.code === 'stale_no_progress_projection_during_running_loop'), JSON.stringify(result));
  assert(!result.issues.some((issue) => issue.code === 'no_progress_observed'), JSON.stringify(result));
  assert.equal(result.progress.run_stamp, '20261003T042027Z');
});

test('ignores stale no-progress projection after successful deterministic repair run', () => {
  const repo = makeRepo();
  writeTodo(repo, `${externalBlockerTodo}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'last_run_succeeded',
    run_id: 'todo-deterministic-decomposition-20261002T162548Z',
    consecutive_failures: 0,
    detail: 'Applied deterministic TODO decomposition repair before invoking Brownie'
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 4,
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      selected_todo: implementationTodo
    }
  });

  const result = diagnosePhaseLoop({ repoRoot: repo, write: false, timestamp: '2026-10-02T00:00:00Z' });

  assert.equal(result.summary.should_notify, false, JSON.stringify(result.issues));
  assert(!result.issues.some((issue) => issue.code === 'no_progress_observed'), JSON.stringify(result));
});

test('classifies explicit blocker-only stop without stale no-progress warning', () => {
  const repo = makeRepo();
  writeTodo(repo, `${externalBlockerTodo}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'blocked',
    run_id: 'owner-blockers-only-20261002T162841Z',
    consecutive_failures: 0,
    detail: 'No implementable TODO remains; pending queue contains only explicit owner-controlled blocker TODOs. Phase-loop is stopped until owner/review evidence changes.'
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 2,
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      selected_todo: implementationTodo
    }
  });

  const result = diagnosePhaseLoop({ repoRoot: repo, write: false, timestamp: '2026-10-02T00:00:00Z' });

  assert.equal(result.summary.should_notify, true);
  assert(result.issues.some((issue) => issue.code === 'owner_blockers_only'), JSON.stringify(result));
  assert(!result.issues.some((issue) => issue.code === 'phase_loop_not_healthy'), JSON.stringify(result));
  assert(!result.issues.some((issue) => issue.code === 'no_progress_observed'), JSON.stringify(result));
});

test('classifies owner blocker stop with dirty worktree as delivery required', () => {
  const repo = makeRepo();
  writeTodo(repo, `${externalBlockerTodo}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'blocked',
    run_id: 'owner-blockers-only-20261002T162841Z',
    consecutive_failures: 0,
    detail: 'No implementable TODO remains; pending queue contains only explicit owner-controlled blocker TODOs. Phase-loop is stopped until owner/review evidence changes.'
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  fs.writeFileSync(path.join(repo, 'README.md'), 'dirty delivery work\n');

  const result = diagnosePhaseLoop({ repoRoot: repo, write: false, timestamp: '2026-10-02T00:00:00Z' });

  assert.equal(result.summary.should_notify, true);
  assert.equal(result.summary.next_action, 'prepare_delivery_commit_pr');
  assert(result.issues.some((issue) => issue.code === 'delivery_required'), JSON.stringify(result));
  assert(result.issues.some((issue) => issue.code === 'owner_blockers_only'), JSON.stringify(result));
  assert(!result.issues.some((issue) => issue.code === 'phase_loop_not_healthy'), JSON.stringify(result));
});

test('treats blocked_todo_recorded as a healthy transient while supervisor is running', () => {
  const repo = makeRepo();
  writeTodo(repo, `${externalBlockerTodo}\n\n${implementationTodo}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'blocked_todo_recorded',
    run_id: 'explicit-blocker-20261002T185443Z',
    consecutive_failures: 0,
    detail: 'Selected TODO is an explicit owner/release blocker with no safe implementation path; recorded it as blocked and will continue with the next unblocked TODO.'
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 1,
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      selected_todo: implementationTodo
    }
  });

  const result = diagnosePhaseLoop({ repoRoot: repo, write: false, timestamp: '2026-10-02T00:00:00Z' });

  assert.equal(result.summary.should_notify, false, JSON.stringify(result.issues));
  assert(!result.issues.some((issue) => issue.code === 'phase_loop_not_healthy'), JSON.stringify(result));
  assert(!result.issues.some((issue) => issue.code === 'no_progress_observed'), JSON.stringify(result));
});

test('reports invalid TODO contract before implementation work', () => {
  const repo = makeRepo();
  writeTodo(repo, `- [ ] E-bad: Patch only \`scripts/missing.mjs\`:
  Route: implementation.
  Source TODO: E-parent.
`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'running',
    run_id: 'run-invalid',
    consecutive_failures: 0
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);

  const result = diagnosePhaseLoop({ repoRoot: repo, write: false, timestamp: '2026-10-02T00:00:00Z' });

  assert.equal(result.summary.should_notify, true);
  assert(result.issues.some((issue) => issue.code === 'todo_contract_invalid'), JSON.stringify(result));
});

test('reports TODO queue integrity failures as supervisor-control blockers', () => {
  const repo = makeRepo();
  writeTodo(repo, `${implementationTodo}\n\n${externalBlockerTodo}\n`);
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `${externalBlockerTodo}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'running',
    run_id: 'run-queue-drift',
    consecutive_failures: 0
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);

  const result = diagnosePhaseLoop({ repoRoot: repo, write: false, timestamp: '2026-10-02T00:00:00Z' });

  assert.equal(result.summary.should_notify, true);
  assert.equal(result.summary.next_action, 'cause_analysis_then_guard_or_queue_repair_before_worker_retry');
  assert(result.issues.some((issue) => issue.code === 'todo_queue_integrity_invalid'), JSON.stringify(result));
  assert.equal(result.todo.queue_integrity.valid, false);
});

test('extracts semantic repair context from failed verification output', () => {
  const repo = makeRepo();
  writeTodo(repo, `${runtimeEvidenceTodo}\n`);
  const failedStdout = [
    '✖ runtime operational evidence models release operation as executable fail-closed evidence (26590ms)',
    '  AssertionError [ERR_ASSERTION]: guard should pass for valid executable evidence',
    '      at TestContext.<anonymous> (file:///workspace/scripts/guard-runtime-operational-evidence.test.mjs:54:10)',
    'test at scripts/guard-runtime-operational-evidence.test.mjs:46:1',
    'actual: false',
    'expected: true',
    'operator: =='
  ].join('\n');
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-verification-failed',
    consecutive_failures: 8,
    detail: `Selected TODO verified-noop fallback was eligible but failed safely before invoking Brownie: ${JSON.stringify({
      completed: false,
      reason: 'dirty_baseline_verification_failed',
      results: [
        {
          command: 'pnpm --workspace-root release:runtime-operational-evidence:test',
          exit_code: 1,
          stdout_tail: failedStdout,
          stderr_tail: ''
        }
      ]
    })}`
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 5,
    progress_projection: {
      cli_status: 'verified_noop_failed',
      closure: 'no_progress',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-runtime-evidence',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });

  const result = diagnosePhaseLoop({ repoRoot: repo, write: false, timestamp: '2026-10-02T00:00:00Z' });
  const issue = result.issues.find((candidate) => candidate.code === 'verification_failure_requires_semantic_repair');

  assert(issue, JSON.stringify(result, null, 2));
  assert.equal(result.summary.next_action, 'cause_analysis_then_guard_or_queue_repair_before_worker_retry');
  assert.equal(result.verification_failure.selected_todo.id, 'E-21c-runtime-operational-evidence-impl-2-target-02');
  assert.deepEqual(result.verification_failure.selected_todo.patch_targets, ['scripts/guard-runtime-operational-evidence.test.mjs']);
  assert.deepEqual(result.verification_failure.selected_todo.verification_commands, ['pnpm --workspace-root release:runtime-operational-evidence:test']);
  assert.equal(result.verification_failure.failed_commands[0].command, 'pnpm --workspace-root release:runtime-operational-evidence:test');
  assert.equal(result.verification_failure.failed_commands[0].test_failures[0].name, 'runtime operational evidence models release operation as executable fail-closed evidence');
  assert.equal(result.verification_failure.failed_commands[0].test_failures[0].assertion, 'guard should pass for valid executable evidence');
});

test('extracts semantic repair context from repair feedback while status is running', () => {
  const repo = makeRepo();
  writeTodo(repo, `${runtimeEvidenceTodo}\n`);
  const failedStdout = [
    'test at scripts/guard-runtime-operational-evidence.test.mjs:354:1',
    '✖ collector keeps version-only soak fail-closed (290ms)',
    '  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:',
    "actual: [ 'ledger_workspace_consistency' ]",
    "expected: [ 'ledger_workspace_consistency', 'evidence_chain_integrity' ]",
    'operator: deepStrictEqual'
  ].join('\n');
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'running',
    run_id: '20261003T094551Z',
    consecutive_failures: 0,
    detail: 'Brownie run started'
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 3,
    run_stamp: '20261003T094358Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    claim_id: 'claim-runtime-evidence-r53',
    reason: 'dirty_baseline_verification_failed',
    verification: {
      completed: false,
      reason: 'dirty_baseline_verification_failed',
      failed_commands: ['pnpm --workspace-root release:runtime-operational-evidence:test'],
      stdout_tail: failedStdout,
      stderr_tail: ''
    }
  });

  const result = diagnosePhaseLoop({ repoRoot: repo, write: false, timestamp: '2026-10-02T00:00:00Z' });
  const issue = result.issues.find((candidate) => candidate.code === 'verification_failure_requires_semantic_repair');

  assert(issue, JSON.stringify(result, null, 2));
  assert.equal(result.summary.next_action, 'cause_analysis_then_guard_or_queue_repair_before_worker_retry');
  assert.equal(result.verification_failure.source, 'repair-feedback');
  assert.equal(result.verification_failure.claim_id, 'claim-runtime-evidence-r53');
  assert.equal(result.verification_failure.failed_commands[0].command, 'pnpm --workspace-root release:runtime-operational-evidence:test');
  assert.equal(result.verification_failure.failed_commands[0].test_failures[0].name, 'collector keeps version-only soak fail-closed');
});

test('classifies stalled semantic verification repair after repeated no-progress', () => {
  const repo = makeRepo();
  writeTodo(repo, `${runtimeEvidenceTodo}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'running',
    run_id: '20261003T122713Z',
    consecutive_failures: 0,
    detail: 'Brownie run started'
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 3,
    run_stamp: '20261003T122514Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    claim_id: 'claim-stalled-semantic',
    reason: 'dirty_baseline_verification_failed',
    verification: {
      completed: false,
      reason: 'dirty_baseline_verification_failed',
      failed_commands: ['pnpm --workspace-root release:runtime-operational-evidence:test'],
      stdout_tail: [
        'test at scripts/guard-runtime-operational-evidence.test.mjs:354:1',
        '✖ collector keeps version-only soak fail-closed (110ms)',
        'AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:'
      ].join('\n'),
      stderr_tail: ''
    }
  });

  const result = diagnosePhaseLoop({ repoRoot: repo, write: false, timestamp: '2026-10-02T00:00:00Z' });

  assert(result.issues.some((issue) => issue.code === 'verification_failure_requires_semantic_repair'), JSON.stringify(result));
  assert(result.issues.some((issue) => issue.code === 'semantic_verification_repair_stalled'), JSON.stringify(result));
  assert.equal(result.summary.next_action, 'cause_analysis_then_guard_or_queue_repair_before_worker_retry');
});

test('classifies invalid workspace.write patch proposals from repair feedback', () => {
  const repo = makeRepo();
  writeTodo(repo, `${runtimeEvidenceTodo}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-invalid-patch',
    consecutive_failures: 1,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 2,
    run_stamp: '20261003T102635Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    claim_id: 'claim-invalid-patch',
    reason: 'runtime_terminal_failure',
    verification: {
      completed: false,
      reason: 'runtime_terminal_failure',
      invalid_patch_proposals: [
        {
          path: 'scripts/guard-runtime-operational-evidence.test.mjs',
          operation: 'patch_file',
          validation_reason: 'Patch old_text was not found in the current target.',
          content_preview: '[patch_file single_hunk old_chars=478 new_chars=938]',
          hunk_count: 1
        }
      ]
    }
  });

  const result = diagnosePhaseLoop({ repoRoot: repo, write: false, timestamp: '2026-10-02T00:00:00Z' });
  const issue = result.issues.find((candidate) => candidate.code === 'invalid_workspace_write_patch_repeated');

  assert(issue, JSON.stringify(result, null, 2));
  assert.equal(result.summary.next_action, 'cause_analysis_then_guard_or_queue_repair_before_worker_retry');
  assert.equal(result.invalid_patch.claim_id, 'claim-invalid-patch');
  assert.equal(result.invalid_patch.invalid_patch_proposals[0].path, 'scripts/guard-runtime-operational-evidence.test.mjs');
  assert.equal(result.invalid_patch.invalid_patch_proposals[0].validation_reason, 'Patch old_text was not found in the current target.');
});

test('classifies nested invalid patch repair feedback emitted by supervisor control', () => {
  const repo = makeRepo();
  writeTodo(repo, `${runtimeEvidenceTodo}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-nested-invalid-patch',
    consecutive_failures: 1,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 2,
    run_stamp: '20261003T165100Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    schema_version: 1,
    kind: 'phase_loop_invalid_patch_repair_feedback',
    reason: 'supervisor_invalid_workspace_write_patch',
    invalid_patch: {
      detected: true,
      claim_id: 'claim-nested-invalid-patch',
      reason: 'runtime_terminal_failure',
      selected_todo: {
        first_line: runtimeEvidenceTodo.split('\n')[0],
        route: 'implementation',
        patch_targets: ['scripts/guard-runtime-operational-evidence.test.mjs'],
        verification_commands: ['pnpm --workspace-root release:runtime-operational-evidence:test']
      },
      invalid_patch_proposals: [
        {
          path: 'scripts/guard-runtime-operational-evidence.test.mjs',
          operation: 'patch_file',
          validation_reason: 'Patch old_text was not found in the current target.',
          content_preview: '[patch_file single_hunk old_chars=478 new_chars=1406]',
          hunk_count: 1
        }
      ]
    }
  });

  const result = diagnosePhaseLoop({ repoRoot: repo, write: false, timestamp: '2026-10-02T00:00:00Z' });
  const issue = result.issues.find((candidate) => candidate.code === 'invalid_workspace_write_patch_repeated');

  assert(issue, JSON.stringify(result, null, 2));
  assert.equal(result.invalid_patch.claim_id, 'claim-nested-invalid-patch');
  assert.equal(result.invalid_patch.reason, 'runtime_terminal_failure');
  assert.equal(result.invalid_patch.invalid_patch_proposals[0].path, 'scripts/guard-runtime-operational-evidence.test.mjs');
});

test('classifies rejected bounded leaf TODO refinement as target repair', () => {
  const repo = makeRepo();
  writeTodo(repo, `${runtimeEvidenceTodo}\n`);
  const apply = {
    applied: false,
    operation: 'valid_todo_patch_proposal_fallback',
    proposal_id: 'proposal-test',
    reason: 'selected_todo_is_already_a_bounded_leaf',
    repair_hint: 'Do not refine a bounded leaf TODO into another child TODO.',
    selected_patch_targets: ['scripts/guard-runtime-operational-evidence.test.mjs'],
    selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0],
    semantic_repair_policy: {
      mode: 'bounded_leaf_target_repair'
    },
    source_run_id: 'run-test'
  };
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-apply-rejected',
    consecutive_failures: 1,
    detail: `Rejected Brownie TODO refinement proposal before applying it because TODO guard preflight failed; recorded repair feedback. apply=${JSON.stringify(apply)} stdout=/tmp/stdout.log progress=/tmp/progress.json`
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'continuation_required',
    same_progress_count: 1,
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'routed_explicit_action',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-apply-rejected',
    status: 'in_progress',
    selected_todo: runtimeEvidenceTodo
  });

  const result = diagnosePhaseLoop({ repoRoot: repo, write: false, timestamp: '2026-10-02T00:00:00Z' });
  const issue = result.issues.find((candidate) => candidate.code === 'bounded_leaf_refinement_rejected');

  assert(issue, JSON.stringify(result, null, 2));
  assert.equal(result.summary.next_action, 'cause_analysis_then_guard_or_queue_repair_before_worker_retry');
  assert.equal(result.apply_rejection.reason, 'selected_todo_is_already_a_bounded_leaf');
  assert.equal(result.apply_rejection.bounded_leaf_refinement, true);
  assert.deepEqual(result.apply_rejection.selected_todo.patch_targets, ['scripts/guard-runtime-operational-evidence.test.mjs']);
  assert.equal(result.apply_rejection.repair_policy.mode, 'force_bounded_leaf_target_patch');
});
