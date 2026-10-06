#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isExplicitBlockerTodo, evaluateTodoQueue } from './phase-loop-todo-evaluator.mjs';
import { validateTodoDecomposition } from './guard-todo-decomposition.mjs';
import { diagnoseDeliveryReconciliation } from './phase-loop-delivery-reconcile.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');

function readJsonOrNull(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readTextOrNull(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function tailText(filePath, maxChars = 4000) {
  const text = readTextOrNull(filePath);
  if (typeof text !== 'string') {
    return null;
  }
  return text.slice(-maxChars);
}

function sanitizeLocalPaths(text, repoRoot) {
  if (typeof text !== 'string') {
    return text;
  }
  let sanitized = text;
  if (repoRoot) {
    sanitized = sanitized.split(repoRoot).join('<workspace>');
  }
  return sanitized
    .replaceAll(/\/Users\/[^\s"'`]+/gu, '<local-path>')
    .replaceAll(/\/home\/[^\s"'`]+/gu, '<local-path>')
    .replaceAll(/[A-Za-z]:\\Users\\[^\s"'`]+/gu, '<local-path>');
}

function parseArgs(argv) {
  const args = {
    repo: defaultRepoRoot,
    write: true
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--repo') {
      args.repo = path.resolve(argv[++index]);
    } else if (arg === '--write') {
      args.write = true;
    } else if (arg === '--no-write') {
      args.write = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function gitStatusShort(repoRoot) {
  try {
    return execFileSync('git', ['status', '--short'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trimEnd();
  } catch {
    return null;
  }
}

function parseJsonFromCommandOutput(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function runTodoQueueIntegrity(repoRoot) {
  const scriptPath = path.join(repoRoot, 'scripts/phase-loop-todo-queue-integrity.mjs');
  const todoPath = path.join(repoRoot, '.brownie/todo.md');
  if (!fs.existsSync(scriptPath) || !fs.existsSync(todoPath)) {
    return {
      available: false,
      valid: null,
      reason: 'todo_queue_integrity_guard_unavailable'
    };
  }

  try {
    const stdout = execFileSync(process.execPath, [
      'scripts/phase-loop-todo-queue-integrity.mjs',
      '--repo',
      repoRoot,
      '--todo',
      '.brownie/todo.md'
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const parsed = parseJsonFromCommandOutput(stdout);
    return {
      available: true,
      valid: true,
      result: parsed ?? { raw_stdout: sanitizeLocalPaths(stdout, repoRoot) }
    };
  } catch (error) {
    const stdout = error?.stdout?.toString?.() ?? '';
    const stderr = error?.stderr?.toString?.() ?? '';
    const parsed = parseJsonFromCommandOutput(stdout) ?? parseJsonFromCommandOutput(stderr);
    return {
      available: true,
      valid: false,
      exit_code: typeof error?.status === 'number' ? error.status : null,
      result: parsed,
      stdout_tail: sanitizeLocalPaths(stdout.slice(-4000), repoRoot),
      stderr_tail: sanitizeLocalPaths(stderr.slice(-4000), repoRoot)
    };
  }
}

function processExists(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    return false;
  }
  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
}

function readProcessTable() {
  try {
    const stdout = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return stdout
      .split('\n')
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/u);
        if (!match) {
          return null;
        }
        return {
          pid: Number(match[1]),
          ppid: Number(match[2]),
          command: match[3]
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function analyzeProcessTree(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    return {
      available: false,
      pid: null,
      descendants: [],
      nested_supervise_descendants: []
    };
  }
  const table = readProcessTable();
  if (table.length === 0) {
    return {
      available: false,
      pid: numericPid,
      descendants: [],
      nested_supervise_descendants: []
    };
  }
  const byParent = new Map();
  for (const processInfo of table) {
    if (!byParent.has(processInfo.ppid)) {
      byParent.set(processInfo.ppid, []);
    }
    byParent.get(processInfo.ppid).push(processInfo);
  }
  const descendants = [];
  const queue = [...(byParent.get(numericPid) ?? [])];
  const seen = new Set([numericPid]);
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || seen.has(next.pid)) {
      continue;
    }
    seen.add(next.pid);
    descendants.push(next);
    queue.push(...(byParent.get(next.pid) ?? []));
  }
  return {
    available: true,
    pid: numericPid,
    descendants: descendants.slice(0, 50),
    nested_supervise_descendants: unexpectedNestedSuperviseDescendants(descendants, numericPid)
  };
}

export function unexpectedNestedSuperviseDescendants(descendants, rootPid) {
  const numericRootPid = Number(rootPid);
  return descendants.filter((processInfo) => {
    if (!/phase-loop\.sh\s+supervise/u.test(processInfo.command)) {
      return false;
    }
    // `phase-loop.sh start` records a lightweight parent pid that owns one
    // direct `phase-loop.sh supervise` child. That direct child is the normal
    // worker wrapper, not a nested supervisor. Only supervise processes below
    // that wrapper indicate multi-owner control of status/progress.
    return processInfo.ppid !== numericRootPid;
  });
}

function progressRunStamp(progress) {
  const raw = progress?.run_stamp ?? progress?.run_id ?? progress?.progress_projection?.run_stamp ?? null;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function todoFirstLine(block) {
  return typeof block === 'string' ? block.split('\n')[0]?.trim() ?? '' : '';
}

function classifySelectedTodo(selectedTodo) {
  const firstLine = todoFirstLine(selectedTodo);
  const route = selectedTodo
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('Route:'))
    ?.slice('Route:'.length)
    .trim()
    .replace(/[.]$/u, '')
    .toLowerCase() ?? '';
  return {
    first_line: firstLine || null,
    route: route || null,
    explicit_blocker: Boolean(selectedTodo && isExplicitBlockerTodo(selectedTodo)),
    todo_decomposition: Boolean(firstLine.includes('TODO-decompose-') || route === 'todo-decomposition')
  };
}

function selectedTodoId(firstLine) {
  if (typeof firstLine !== 'string') {
    return null;
  }
  const match = firstLine.match(/^\s*[-*]\s+\[[ xX]\]\s+([^:\n]+):/u);
  return match?.[1] ?? null;
}

function extractBacktickValues(line) {
  if (typeof line !== 'string') {
    return [];
  }
  return [...line.matchAll(/`([^`]+)`/gu)].map((match) => match[1]).filter(Boolean);
}

function extractTodoPatchTargets(selectedTodo) {
  if (typeof selectedTodo !== 'string') {
    return [];
  }
  const targets = [];
  for (const line of selectedTodo.split('\n')) {
    if (/\b(?:Patch|Create|Edit|Modify)\s+only\b/iu.test(line)) {
      targets.push(...extractBacktickValues(line));
    }
  }
  return [...new Set(targets)];
}

function extractTodoVerificationCommands(selectedTodo) {
  if (typeof selectedTodo !== 'string') {
    return [];
  }
  const commands = [];
  for (const line of selectedTodo.split('\n')) {
    if (/^\s*Verification:/iu.test(line)) {
      commands.push(...extractBacktickValues(line));
    }
  }
  return [...new Set(commands)];
}

function extractNodeTestFailures(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return [];
  }
  const failures = [];
  const lines = text.split('\n');
  let current = null;
  for (const line of lines) {
    const testAt = line.match(/\btest at ([^:\n]+):(\d+):(\d+)/u);
    if (testAt) {
      current = {
        file: testAt[1],
        line: Number(testAt[2]),
        column: Number(testAt[3])
      };
      failures.push(current);
      continue;
    }
    const timedTestName = line.match(/^\s*✖\s+(.+?)\s+\((\d+(?:\.\d+)?)ms\)\s*$/u);
    const untimedTestName = timedTestName ? null : line.match(/^\s*✖\s+(.+?)\s*$/u);
    const testName = timedTestName ?? untimedTestName;
    if (testName) {
      if (/^failing tests:?$/iu.test(testName[1].trim())) {
        continue;
      }
      if (!current) {
        current = {};
        failures.push(current);
      }
      current.name = testName[1].trim();
      current.duration_ms = testName[2] ? Number(testName[2]) : null;
      continue;
    }
    const assertion = line.match(/AssertionError(?:\s+\[[^\]]+\])?:\s+(.+)$/u);
    if (assertion) {
      if (!current) {
        current = {};
        failures.push(current);
      }
      current.assertion = assertion[1].trim();
      continue;
    }
    const actual = line.match(/^\s*actual:\s+(.+)$/u);
    if (actual && current) {
      current.actual = actual[1].trim();
      continue;
    }
    const expected = line.match(/^\s*expected:\s+(.+)$/u);
    if (expected && current) {
      current.expected = expected[1].trim();
      continue;
    }
    const operator = line.match(/^\s*operator:\s+(.+)$/u);
    if (operator && current) {
      current.operator = operator[1].trim();
    }
  }
  return failures.filter((failure) => Object.keys(failure).length > 0);
}

function analyzeVerificationFailure(status, selectedTodo, repoRoot) {
  const parsedDetail = parseJsonFromCommandOutput(String(status?.detail ?? ''));
  const results = Array.isArray(parsedDetail?.results) ? parsedDetail.results : [];
  const failedResults = results.filter((result) => {
    const exitCode = Number(result?.exit_code ?? 0);
    return Number.isFinite(exitCode) && exitCode !== 0;
  });
  const reason = typeof parsedDetail?.reason === 'string' ? parsedDetail.reason : null;
  const verificationFailureReason = reason && (
    reason.includes('verification_failed') ||
    reason.includes('verification') ||
    reason.includes('dirty_baseline')
  );
  if (failedResults.length === 0 && !verificationFailureReason) {
    return {
      detected: false
    };
  }

  const selected = classifySelectedTodo(selectedTodo);
  const commandFailures = failedResults.map((result) => {
    const stdoutTail = sanitizeLocalPaths(String(result?.stdout_tail ?? result?.stdout ?? '').slice(-4000), repoRoot);
    const stderrTail = sanitizeLocalPaths(String(result?.stderr_tail ?? result?.stderr ?? '').slice(-4000), repoRoot);
    return {
      command: typeof result?.command === 'string' ? result.command : null,
      exit_code: Number.isFinite(Number(result?.exit_code)) ? Number(result.exit_code) : null,
      stdout_tail: stdoutTail,
      stderr_tail: stderrTail,
      test_failures: extractNodeTestFailures(`${stdoutTail}\n${stderrTail}`).slice(0, 10)
    };
  });

  return {
    detected: true,
    reason,
    selected_todo: {
      id: selectedTodoId(selected.first_line),
      first_line: selected.first_line,
      route: selected.route,
      patch_targets: extractTodoPatchTargets(selectedTodo),
      verification_commands: extractTodoVerificationCommands(selectedTodo)
    },
    failed_commands: commandFailures,
    repair_policy: {
      mode: 'bounded_selected_target_semantic_repair',
      must_preserve_selected_todo_intent: true,
      must_not_only_make_checks_green: true,
      must_not_weaken_guards_or_tests: true,
      must_rerun_failed_command: true
    }
  };
}

function analyzeRepairFeedbackVerificationFailure(repairFeedback, selectedTodo, repoRoot) {
  if (!repairFeedback || typeof repairFeedback !== 'object') {
    return {
      detected: false
    };
  }
  const verification = repairFeedback.verification && typeof repairFeedback.verification === 'object'
    ? repairFeedback.verification
    : null;
  if (!verification || verification.completed !== false) {
    return {
      detected: false
    };
  }
  const failedCommands = Array.isArray(verification.failed_commands)
    ? verification.failed_commands.filter((command) => typeof command === 'string' && command.length > 0)
    : [];
  const reason = typeof verification.reason === 'string' ? verification.reason : null;
  const verificationFailureReason = reason && (
    reason.includes('verification_failed') ||
    reason.includes('verification') ||
    reason.includes('dirty_baseline')
  );
  if (failedCommands.length === 0 && !verificationFailureReason) {
    return {
      detected: false
    };
  }
  const stdoutTail = sanitizeLocalPaths(String(verification.stdout_tail ?? '').slice(-4000), repoRoot);
  const stderrTail = sanitizeLocalPaths(String(verification.stderr_tail ?? '').slice(-4000), repoRoot);
  const selected = classifySelectedTodo(selectedTodo);
  return {
    detected: true,
    source: 'repair-feedback',
    claim_id: typeof repairFeedback.claim_id === 'string' ? repairFeedback.claim_id : null,
    reason,
    selected_todo: {
      id: selectedTodoId(selected.first_line),
      first_line: selected.first_line,
      route: selected.route,
      patch_targets: extractTodoPatchTargets(selectedTodo),
      verification_commands: extractTodoVerificationCommands(selectedTodo)
    },
    failed_commands: failedCommands.map((command) => ({
      command,
      exit_code: null,
      stdout_tail: stdoutTail,
      stderr_tail: stderrTail,
      test_failures: extractNodeTestFailures(`${stdoutTail}\n${stderrTail}`).slice(0, 10)
    })),
    repair_policy: {
      mode: 'repair_feedback_semantic_verification_repair',
      must_preserve_selected_todo_intent: true,
      must_not_only_make_checks_green: true,
      must_not_weaken_guards_or_tests: true,
      must_rerun_failed_command: true
    }
  };
}

function analyzeRepairFeedbackInvalidPatch(repairFeedback, selectedTodo) {
  if (!repairFeedback || typeof repairFeedback !== 'object') {
    return {
      detected: false
    };
  }
  const nestedInvalidPatch = repairFeedback.invalid_patch && typeof repairFeedback.invalid_patch === 'object'
    ? repairFeedback.invalid_patch
    : null;
  const verification = repairFeedback.verification && typeof repairFeedback.verification === 'object'
    ? repairFeedback.verification
    : null;
  const proposalsSource = Array.isArray(nestedInvalidPatch?.invalid_patch_proposals)
    ? nestedInvalidPatch.invalid_patch_proposals
    : Array.isArray(verification?.invalid_patch_proposals)
      ? verification.invalid_patch_proposals
      : [];
  const proposals = Array.isArray(proposalsSource)
    ? proposalsSource.filter((proposal) => proposal && typeof proposal === 'object')
    : [];
  if (proposals.length === 0) {
    return {
      detected: false
    };
  }
  const selected = classifySelectedTodo(selectedTodo);
  const nestedSelectedTodo = nestedInvalidPatch?.selected_todo && typeof nestedInvalidPatch.selected_todo === 'object'
    ? nestedInvalidPatch.selected_todo
    : null;
  const nestedFirstLine = typeof nestedSelectedTodo?.first_line === 'string'
    ? nestedSelectedTodo.first_line
    : null;
  const effectiveFirstLine = selected.first_line ?? nestedFirstLine;
  return {
    detected: true,
    source: 'repair-feedback',
    claim_id: typeof nestedInvalidPatch?.claim_id === 'string'
      ? nestedInvalidPatch.claim_id
      : typeof repairFeedback.claim_id === 'string'
        ? repairFeedback.claim_id
        : null,
    reason: typeof nestedInvalidPatch?.reason === 'string'
      ? nestedInvalidPatch.reason
      : typeof verification?.reason === 'string'
        ? verification.reason
        : typeof repairFeedback.reason === 'string'
          ? repairFeedback.reason
          : null,
    selected_todo: {
      id: selectedTodoId(effectiveFirstLine),
      first_line: effectiveFirstLine,
      route: selected.route ?? nestedSelectedTodo?.route ?? null,
      patch_targets: extractTodoPatchTargets(selectedTodo).length > 0
        ? extractTodoPatchTargets(selectedTodo)
        : Array.isArray(nestedSelectedTodo?.patch_targets)
          ? nestedSelectedTodo.patch_targets
          : [],
      verification_commands: extractTodoVerificationCommands(selectedTodo).length > 0
        ? extractTodoVerificationCommands(selectedTodo)
        : Array.isArray(nestedSelectedTodo?.verification_commands)
          ? nestedSelectedTodo.verification_commands
          : []
    },
    invalid_patch_proposals: proposals.map((proposal) => ({
      path: typeof proposal.path === 'string' ? proposal.path : null,
      operation: typeof proposal.operation === 'string' ? proposal.operation : null,
      validation_reason: typeof proposal.validation_reason === 'string' ? proposal.validation_reason : null,
      content_preview: typeof proposal.content_preview === 'string' ? proposal.content_preview : null,
      hunk_count: Number.isFinite(Number(proposal.hunk_count)) ? Number(proposal.hunk_count) : null
    })),
    repair_policy: {
      mode: 'invalid_patch_exact_context_repair',
      must_preserve_selected_todo_intent: true,
      must_not_repeat_invalid_patch: true,
      must_not_patch_todo_unless_contract_invalid: true,
      allowed_next_actions: [
        'request one bounded workspace.read for the selected target if exact current context is missing',
        'emit one smaller workspace.write patch_file hunk whose old_text exists in the current target',
        'emit one concrete blocker if the selected TODO contract is impossible'
      ]
    }
  };
}

function analyzeApplyRejection(status, selectedTodo) {
  const detail = String(status?.detail ?? '');
  if (!/Rejected Brownie TODO refinement proposal|TODO guard preflight failed|apply=\{/u.test(detail)) {
    return {
      detected: false
    };
  }
  const applyMatch = detail.match(/\bapply=(\{.*\})(?:\s+stdout=|\s+stderr=|\s+progress=|$)/u);
  const apply = applyMatch ? parseJsonFromCommandOutput(applyMatch[1]) : parseJsonFromCommandOutput(detail);
  if (!apply || typeof apply !== 'object') {
    return {
      detected: false
    };
  }
  const selected = classifySelectedTodo(selectedTodo);
  const patchTargets = Array.isArray(apply.selected_patch_targets)
    ? apply.selected_patch_targets.filter((target) => typeof target === 'string' && target.length > 0)
    : extractTodoPatchTargets(selectedTodo);
  const reason = typeof apply.reason === 'string' ? apply.reason : null;
  const boundedLeafRefinement =
    reason === 'selected_todo_is_already_a_bounded_leaf' ||
    (
      selected.route === 'implementation' &&
      patchTargets.length === 1 &&
      /valid_todo_patch_proposal_fallback/u.test(String(apply.operation ?? ''))
    );
  return {
    detected: true,
    reason,
    operation: typeof apply.operation === 'string' ? apply.operation : null,
    proposal_id: typeof apply.proposal_id === 'string' ? apply.proposal_id : null,
    source_run_id: typeof apply.source_run_id === 'string' ? apply.source_run_id : null,
    selected_todo: {
      id: selectedTodoId(selected.first_line),
      first_line: selected.first_line,
      route: selected.route,
      patch_targets: patchTargets,
      verification_commands: extractTodoVerificationCommands(selectedTodo)
    },
    repair_hint: typeof apply.repair_hint === 'string' ? apply.repair_hint : null,
    bounded_leaf_refinement: boundedLeafRefinement,
    repair_policy: {
      mode: boundedLeafRefinement ? 'force_bounded_leaf_target_patch' : 'apply_rejection_repair',
      must_preserve_selected_todo_intent: true,
      must_not_refine_bounded_leaf_todo: boundedLeafRefinement,
      must_patch_selected_target_or_report_blocker: true,
      forbidden_next_actions: boundedLeafRefinement
        ? ['rewrite .brownie/todo.md', 'split bounded leaf again', 'remove selected TODO without passing verification']
        : ['repeat rejected proposal unchanged']
    }
  };
}

function addIssue(issues, severity, code, message, recommendation, extra = {}) {
  issues.push({
    severity,
    code,
    message,
    recommendation,
    ...extra
  });
}

function diagnosticsPath(repoRoot, timestamp) {
  const safeTimestamp = timestamp.replace(/[^0-9A-Za-z_.-]+/gu, '-');
  return path.join(repoRoot, '.brownie/private/phase-loop/supervisor-diagnostics', `${safeTimestamp}.json`);
}

export function diagnosePhaseLoop(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const timestamp = options.timestamp ?? new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z');
  const stateRoot = path.join(repoRoot, '.brownie/private/phase-loop');
  const statusPath = path.join(stateRoot, 'status.json');
  const progressPath = path.join(stateRoot, 'progress-state.json');
  const claimPath = path.join(stateRoot, 'todo-claims/current.json');
  const repairFeedbackPath = path.join(stateRoot, 'todo-claims/repair-feedback.json');
  const todoPath = path.join(repoRoot, '.brownie/todo.md');
  const breakdownPath = path.join(repoRoot, '.brownie/todo-breakdown.md');
  const pidPath = path.join(stateRoot, 'phase-loop.pid');

  const status = readJsonOrNull(statusPath);
  const progress = readJsonOrNull(progressPath);
  const claim = readJsonOrNull(claimPath);
  const repairFeedback = readJsonOrNull(repairFeedbackPath);
  const todoText = readTextOrNull(todoPath) ?? '';
  const breakdownText = readTextOrNull(breakdownPath) ?? '';
  const pid = readTextOrNull(pidPath)?.trim() ?? null;
  const running = processExists(pid);
  const processTree = analyzeProcessTree(pid);
  const claimStatus = String(claim?.status ?? '');
  const activeClaimSelectedTodo = ['claimed', 'in_progress'].includes(claimStatus) ? claim?.selected_todo : null;
  const selectedTodo = activeClaimSelectedTodo ?? progress?.progress_projection?.selected_todo ?? null;
  const selected = classifySelectedTodo(selectedTodo);
  const statusConsecutiveFailures = Number(status?.consecutive_failures ?? 0);
  const progressSameCount = Number(progress?.same_progress_count ?? 0);
  const progressStamp = progressRunStamp(progress);
  const evaluator = todoText
    ? evaluateTodoQueue(todoText, {
        repoRoot,
        blockedPath: path.join(stateRoot, 'todo-claims/blocked.jsonl')
      })
    : null;
  const todoQueueIntegrity = runTodoQueueIntegrity(repoRoot);
  const statusVerificationFailureAnalysis = analyzeVerificationFailure(status, selectedTodo, repoRoot);
  const repairFeedbackVerificationFailureAnalysis = analyzeRepairFeedbackVerificationFailure(repairFeedback, selectedTodo, repoRoot);
  const verificationFailureAnalysis = statusVerificationFailureAnalysis.detected
    ? statusVerificationFailureAnalysis
    : repairFeedbackVerificationFailureAnalysis;
  const invalidPatchAnalysis = analyzeRepairFeedbackInvalidPatch(repairFeedback, selectedTodo);
  const applyRejectionAnalysis = analyzeApplyRejection(status, selectedTodo);
  const gitStatus = gitStatusShort(repoRoot);
  const dirtyFiles = gitStatus
    ? gitStatus.split('\n').map((line) => line.trim()).filter(Boolean)
    : [];
  let deliveryReconciliation = null;
  try {
    const candidate = diagnoseDeliveryReconciliation({ repoRoot, target: 'origin/main' });
    if (candidate.head !== candidate.target_commit) deliveryReconciliation = candidate;
  } catch {
    // A repository without origin/main (for example a unit-test fixture) has no remote delivery to reconcile.
  }
  const evaluatorSelectedTodo = typeof evaluator?.selected_todo === 'string' ? evaluator.selected_todo : '';
  const evaluatorSelectedIsExplicitBlocker =
    evaluatorSelectedTodo.length > 0 && isExplicitBlockerTodo(evaluatorSelectedTodo);
  const noImplementableTodoSelected =
    evaluator?.selected_todo_id === null ||
    evaluatorSelectedIsExplicitBlocker;
  const statusSaysNoImplementableTodo =
    /only explicit owner-controlled blocker TODOs|No implementable TODO remains/iu.test(String(status?.detail ?? ''));
  const ownerBlockersOnlyStop =
    status?.status === 'blocked' &&
    statusConsecutiveFailures === 0 &&
    noImplementableTodoSelected &&
    statusSaysNoImplementableTodo;
  const transientBlockedTodoRecorded =
    status?.status === 'blocked_todo_recorded' &&
    running &&
    statusConsecutiveFailures === 0;
  const issues = [];
  const activeClaimSelectedId = selectedTodoId(todoFirstLine(activeClaimSelectedTodo));

  if (!status) {
    addIssue(
      issues,
      'critical',
      'phase_loop_status_missing',
      'phase-loop status.json が見つからないか壊れています。',
      'phase-loop の状態保存先を確認し、必要なら supervisor を再起動する。'
    );
  }

  if (status?.status === 'running' && !running) {
    addIssue(
      issues,
      'critical',
      'phase_loop_pid_stale',
      'status は running ですが pid が生存していません。',
      '単純再起動の前に直近runとstderrを確認し、停止原因をTODO/guard/実装へ分類する。',
      { pid }
    );
  } else if (ownerBlockersOnlyStop) {
    addIssue(
      issues,
      'warning',
      'owner_blockers_only',
      '実装可能TODOは残っておらず、明示的なowner/release-ops blockerだけが残ったため phase-loop は安全停止しています。',
      'owner/release-ops証跡を投入するか、Brownieで実装可能な具体TODOへ置換するまではworkerを再起動しない。',
      { status: status.status }
    );
  } else if (status && status.status !== 'running' && status.status !== 'last_run_succeeded' && !transientBlockedTodoRecorded) {
    addIssue(
      issues,
      status.status === 'blocked' ? 'warning' : 'critical',
      'phase_loop_not_healthy',
      `phase-loop status が ${status.status} です。`,
      '停止理由を分類し、owner/external blocker以外なら修正TODOまたはguard改善TODOを投入する。',
      { status: status.status }
    );
  }

  if (statusConsecutiveFailures >= 2) {
    addIssue(
      issues,
      statusConsecutiveFailures >= 5 ? 'critical' : 'warning',
      'consecutive_failures_repeated',
      `consecutive_failures=${statusConsecutiveFailures} です。`,
      '同じ失敗を繰り返している可能性があるため、選択TODO・guard・stdout/stderrを横断して原因を分類する。',
      { consecutive_failures: statusConsecutiveFailures }
    );
  }

  const staleNoProgressProjectionDuringRunningLoop =
    progress?.classification === 'no_progress' &&
    status?.status === 'running' &&
    statusConsecutiveFailures === 0 &&
    progressSameCount >= 3 &&
    Boolean(status?.run_id) &&
    Boolean(progressStamp) &&
    status.run_id !== progressStamp;
  if (staleNoProgressProjectionDuringRunningLoop) {
    addIssue(
      issues,
      'critical',
      'stale_no_progress_projection_during_running_loop',
      `phase-loop は run_id=${status.run_id} で稼働中ですが、progress-state は古い run_stamp=${progressStamp} の no-progress を指しています。`,
      'running だけで健全と見なさず、前回 no-progress の修復feedbackを現在runへ引き継ぐか、進捗stateを現在runで更新してから再診断する。',
      {
        status_run_id: status.run_id,
        progress_run_stamp: progressStamp,
        same_progress_count: progressSameCount
      }
    );
  }

  if (processTree.nested_supervise_descendants.length > 0) {
    addIssue(
      issues,
      'warning',
      'nested_phase_loop_supervise_process',
      `phase-loop supervise の子孫プロセスが ${processTree.nested_supervise_descendants.length} 件あります。`,
      '単一Supervisor前提が崩れるとstatus/progressの所有者が曖昧になるため、多重起動か正常なwrapperかを確認し、必要なら単一制御へ畳み込む。',
      {
        nested_supervise_descendants: processTree.nested_supervise_descendants.slice(0, 10)
      }
    );
  }

  const progressNoProgressIsStaleAfterSuccessfulRun =
    progress?.classification === 'no_progress' &&
    status?.status === 'last_run_succeeded' &&
    statusConsecutiveFailures === 0;
  const progressNoProgressIsStaleAfterOwnerBlockerStop =
    progress?.classification === 'no_progress' &&
    ownerBlockersOnlyStop;
  const progressNoProgressIsStaleAfterBlockedTodoRecorded =
    progress?.classification === 'no_progress' &&
    transientBlockedTodoRecorded;
  const progressNoProgressIsTransientDuringHealthyRun =
    progress?.classification === 'no_progress' &&
    status?.status === 'running' &&
    statusConsecutiveFailures === 0 &&
    progressSameCount < 3;
  if (
    (progress?.classification === 'no_progress' || status?.status === 'no_progress') &&
    !progressNoProgressIsStaleAfterSuccessfulRun &&
    !progressNoProgressIsStaleAfterOwnerBlockerStop &&
    !progressNoProgressIsStaleAfterBlockedTodoRecorded &&
    !progressNoProgressIsTransientDuringHealthyRun &&
    !staleNoProgressProjectionDuringRunningLoop
  ) {
    addIssue(
      issues,
      progressSameCount >= 3 ? 'critical' : 'warning',
      'no_progress_observed',
      `no-progress が観測されています。same_progress_count=${progressSameCount}。`,
      '実装再試行ではなく、TODO選択・TODO契約・guard不足・外部blocker誤選択のどれかをまず診断する。',
      { same_progress_count: progressSameCount }
    );
  }

  const progressProjection = progress?.progress_projection ?? {};
  if (
    selected.explicit_blocker &&
    (
      progressProjection.cli_status === 'no_eligible_task' ||
      progressProjection.closure === 'no_eligible_task' ||
      progress?.classification === 'no_progress'
    )
  ) {
    addIssue(
      issues,
      'critical',
      'explicit_blocker_selected_for_worker',
      'owner/external blocker が Worker 実装対象として選択されています。',
      'TODO evaluator が explicit blocker を選択しないようにし、実装可能TODOを優先する。実装可能TODOが無ければ owner-required として停止する。',
      { selected_todo_first_line: selected.first_line }
    );
  }

  let todoGuardErrors = [];
  try {
    todoGuardErrors = validateTodoDecomposition(repoRoot, '.brownie/todo.md');
  } catch (error) {
    todoGuardErrors = [`todo_decomposition_guard_exception:${error?.message ?? String(error)}`];
  }
  if (todoGuardErrors.length > 0) {
    addIssue(
      issues,
      'critical',
      'todo_contract_invalid',
      'TODO契約 guard が失敗しています。',
      '実装ファイルではなく `.brownie/todo.md` / `.brownie/todo-breakdown.md` を先に修復する。',
      { errors: todoGuardErrors.slice(0, 20) }
    );
  }

  if (todoQueueIntegrity.available && todoQueueIntegrity.valid === false) {
    addIssue(
      issues,
      'critical',
      'todo_queue_integrity_invalid',
      'TODO queue integrity guard が失敗しています。',
      'claim前に `.brownie/todo.md` と replan/completion 証跡の整合性を修復し、同じguardを再実行する。',
      {
        exit_code: todoQueueIntegrity.exit_code,
        result: todoQueueIntegrity.result,
        stderr_tail: todoQueueIntegrity.stderr_tail
      }
    );
  }

  if (
    activeClaimSelectedId &&
    evaluator?.selected_todo_id &&
    activeClaimSelectedId !== evaluator.selected_todo_id
  ) {
    addIssue(
      issues,
      'critical',
      'active_claim_not_selected_by_live_queue',
      `active claim は ${activeClaimSelectedId} を指していますが、live queue の次TODOは ${evaluator.selected_todo_id} です。`,
      '古いclaimを退避して、TODO evaluator の現在の選択からclaimを作り直す。runningだけで健全扱いしない。',
      {
        active_claim_todo_id: activeClaimSelectedId,
        evaluator_selected_todo_id: evaluator.selected_todo_id
      }
    );
  }

  if (verificationFailureAnalysis.detected) {
    const failedCommands = verificationFailureAnalysis.failed_commands
      .map((failure) => failure.command)
      .filter(Boolean);
    const testFailures = verificationFailureAnalysis.failed_commands
      .flatMap((failure) => failure.test_failures ?? [])
      .map((failure) => failure.name ?? failure.assertion ?? failure.file)
      .filter(Boolean);
    addIssue(
      issues,
      'critical',
      'verification_failure_requires_semantic_repair',
      [
        '選択TODOの検証コマンドが失敗しています。',
        failedCommands.length > 0 ? `failed_command=${failedCommands[0]}` : null,
        testFailures.length > 0 ? `failed_test=${testFailures[0]}` : null
      ].filter(Boolean).join(' '),
      'guard/testを弱めず、選択TODOの意図と対象ファイルに沿って意味的に修復し、同じ検証コマンドを再実行する。',
      {
        failure_analysis: verificationFailureAnalysis
      }
    );
    if (progressSameCount >= 3 || staleNoProgressProjectionDuringRunningLoop) {
      addIssue(
        issues,
        'critical',
        'semantic_verification_repair_stalled',
        '同じ選択TODOの semantic verification repair が no-progress とともに停滞しています。',
        '同じ単一ターゲット修復を繰り返さず、選択TODOの対象範囲が不十分ならTODO契約を修正して、実装可能なleafへ再計画する。',
        {
          same_progress_count: progressSameCount,
          failure_analysis: verificationFailureAnalysis
        }
      );
    }
  }

  if (invalidPatchAnalysis.detected) {
    const firstProposal = invalidPatchAnalysis.invalid_patch_proposals[0] ?? {};
    addIssue(
      issues,
      'critical',
      'invalid_workspace_write_patch_repeated',
      [
        '前回の workspace.write patch_file が現在の対象ファイルへ適用できませんでした。',
        firstProposal.path ? `path=${firstProposal.path}` : null,
        firstProposal.validation_reason ? `reason=${firstProposal.validation_reason}` : null
      ].filter(Boolean).join(' '),
      '同じold_textを再利用せず、対象ファイルの現在内容を1回だけ読み直すか、現存する小さなold_textでパッチし直す。TODOを書き換えるのはTODO契約自体が不可能な場合だけにする。',
      {
        invalid_patch: invalidPatchAnalysis
      }
    );
  }

  if (applyRejectionAnalysis.detected) {
    addIssue(
      issues,
      applyRejectionAnalysis.bounded_leaf_refinement ? 'critical' : 'warning',
      applyRejectionAnalysis.bounded_leaf_refinement
        ? 'bounded_leaf_refinement_rejected'
        : 'objective_apply_rejected',
      applyRejectionAnalysis.bounded_leaf_refinement
        ? 'bounded leaf TODO に対して、Brownie がさらにTODO refinementを提案し、guardに拒否されています。'
        : 'Brownie の objective apply 提案が guard preflight で拒否されています。',
      applyRejectionAnalysis.bounded_leaf_refinement
        ? '次回は `.brownie/todo.md` を編集させず、選択TODOの対象ファイルだけを小さく意味的にpatchさせる。'
        : '拒否理由をrepair-feedbackへ反映し、同じ提案を繰り返させない。',
      {
        apply_rejection: applyRejectionAnalysis
      }
    );
  }

  const deliveryDirtyFiles = dirtyFiles.filter((line) => !/^\?\?\s+\.brownie\/private\//u.test(line));
  if (deliveryDirtyFiles.length > 0 && noImplementableTodoSelected) {
    addIssue(
      issues,
      'warning',
      'delivery_required',
      '実装可能TODOは残っていませんが、未コミット差分が残っています。',
      'phase-loopを完了扱いせず、差分を検証して commit / PR / review / merge の配送工程へ進める。',
      {
        dirty_files: deliveryDirtyFiles.slice(0, 50),
        unchecked_todo_count: (todoText.match(/^(?:[-*]|\d+[.)])\s+\[\s\]\s+/gmu) ?? []).length,
        owner_blockers_only: ownerBlockersOnlyStop
      }
    );
  }
  if (dirtyFiles.length > 0) {
    addIssue(
      issues,
      'info',
      'workspace_has_uncommitted_changes',
      `未コミット差分が ${dirtyFiles.length} 件あります。`,
      '既存差分を破壊せず、Brownie/user作業として扱う。PR/merge前に差分を整理する。',
      { dirty_files: dirtyFiles.slice(0, 50) }
    );
  }
  if (deliveryReconciliation?.safe_to_reconcile) {
    addIssue(
      issues,
      'warning',
      'merged_delivery_pending_reconciliation',
      'origin/main へマージ済みの配送内容とローカル作業ツリーを安全に照合できます。',
      'phase-loop:delivery-reconcile をdry-run後、--writeで受領し、preflight成功後にworkerを再開する。',
      {
        head: deliveryReconciliation.head,
        target_commit: deliveryReconciliation.target_commit,
        classified_files: deliveryReconciliation.files.length
      }
    );
  } else if (deliveryReconciliation && !deliveryReconciliation.safe_to_reconcile) {
    addIssue(
      issues,
      'critical',
      'delivery_reconciliation_blocked',
      'origin/mainとの差分に配送履歴で説明できないローカル変更があります。',
      '自動同期せず、unrelated_local_changeをユーザー/Brownie作業として保全して個別確認する。',
      { blockers: deliveryReconciliation.blockers }
    );
  }

  const stdoutLog = progress?.stdout_log ?? null;
  const stderrLog = progress?.stderr_log ?? null;
  const stdoutTail = stdoutLog ? sanitizeLocalPaths(tailText(stdoutLog), repoRoot) : null;
  const stderrTail = stderrLog ? sanitizeLocalPaths(tailText(stderrLog), repoRoot) : null;

  const actionableIssues = issues.filter((issue) => issue.severity !== 'info');
  const shouldNotify = actionableIssues.length > 0;
  const deliveryRequired = issues.some((issue) => issue.code === 'delivery_required');
  const shouldStopWorker = issues.some((issue) => [
    'todo_contract_invalid',
    'todo_queue_integrity_invalid',
    'explicit_blocker_selected_for_worker',
    'phase_loop_pid_stale',
    'stale_no_progress_projection_during_running_loop',
    'verification_failure_requires_semantic_repair',
    'semantic_verification_repair_stalled',
    'invalid_workspace_write_patch_repeated',
    'bounded_leaf_refinement_rejected',
    'merged_delivery_pending_reconciliation',
    'delivery_reconciliation_blocked'
  ].includes(issue.code));
  const nextAction = shouldStopWorker
    ? 'cause_analysis_then_guard_or_queue_repair_before_worker_retry'
    : deliveryRequired
      ? 'prepare_delivery_commit_pr'
    : shouldNotify
      ? 'continue_monitoring_with_targeted_repair'
      : 'silent_continue';

  const result = {
    schema_version: 1,
    diagnostic_kind: 'brownie_phase_loop_supervisor',
    generated_at: timestamp,
    repo_root: repoRoot,
    summary: {
      healthy: actionableIssues.length === 0,
      should_notify: shouldNotify,
      next_action: nextAction
    },
    phase_loop: {
      status: status?.status ?? null,
      running,
      pid,
      run_id: status?.run_id ?? null,
      consecutive_failures: statusConsecutiveFailures,
      detail: status?.detail ?? null
    },
    process_tree: processTree,
    progress: {
      classification: progress?.classification ?? null,
      same_progress_count: progressSameCount,
      run_stamp: progressStamp,
      selected_todo: selected,
      projection_status: progressProjection.cli_status ?? null,
      projection_closure: progressProjection.closure ?? null,
      stdout_log: stdoutLog,
      stderr_log: stderrLog,
      stdout_tail: stdoutTail,
      stderr_tail: stderrTail
    },
    todo: {
      path: '.brownie/todo.md',
      breakdown_path: '.brownie/todo-breakdown.md',
      unchecked_count: (todoText.match(/^(?:[-*]|\d+[.)])\s+\[\s\]\s+/gmu) ?? []).length,
      breakdown_present: breakdownText.length > 0,
      evaluator,
      queue_integrity: todoQueueIntegrity
    },
    verification_failure: verificationFailureAnalysis.detected ? verificationFailureAnalysis : null,
    invalid_patch: invalidPatchAnalysis.detected ? invalidPatchAnalysis : null,
    apply_rejection: applyRejectionAnalysis.detected ? applyRejectionAnalysis : null,
    git: {
      dirty: dirtyFiles.length > 0,
      dirty_files: dirtyFiles
    },
    delivery_reconciliation: deliveryReconciliation,
    issues
  };

  if (options.write !== false) {
    const outputPath = diagnosticsPath(repoRoot, timestamp);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    result.written_path = path.relative(repoRoot, outputPath);
  }

  return result;
}

if (process.argv[1] === __filename) {
  const args = parseArgs(process.argv);
  const result = diagnosePhaseLoop({ repoRoot: args.repo, write: args.write });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.summary.should_notify ? 1 : 0);
}
