#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { diagnosePhaseLoop } from './phase-loop-supervisor-diagnose.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const maxRequestBytes = 12_000;
const maxAttemptsPerFingerprint = 3;
const retryBaseDelayMs = 60_000;
const retryMaxDelayMs = 30 * 60_000;
const maxAppliedRecoveryResumes = 3;

export function trustedExactPatchContext(request) {
  const oldHeadings = [...request.matchAll(/^Trusted exact old_text:\s*$/gmu)];
  const newHeadings = [...request.matchAll(/^Trusted exact new_text:\s*$/gmu)];
  const verificationHeadings = [...request.matchAll(/^Trusted verification commands:\s*$/gmu)];
  if (oldHeadings.length !== 1 || newHeadings.length !== 1 || verificationHeadings.length > 1) return null;

  const oldStart = oldHeadings[0].index + oldHeadings[0][0].length;
  const newStart = newHeadings[0].index + newHeadings[0][0].length;
  if (oldStart >= newHeadings[0].index) return null;

  const oldText = request.slice(oldStart, newHeadings[0].index).trim();
  const verificationStart = verificationHeadings.length === 1
    ? verificationHeadings[0].index
    : request.length;
  if (verificationStart < newStart) return null;
  const newText = request.slice(newStart, verificationStart).trim();
  if (oldText.length === 0 || newText.length === 0) return null;

  const verificationLines = verificationHeadings.length === 0
    ? []
    : request.slice(verificationHeadings[0].index + verificationHeadings[0][0].length)
      .split(/\r?\n/u)
      .map((line) => line.trim());
  if (verificationLines.some((line) => line.length > 0 && !/^-\s+`([^`]+)`\s*$/u.test(line))) return null;
  const commands = verificationLines
    .map((line) => /^-\s+`([^`]+)`\s*$/u.exec(line)?.[1] ?? null)
    .filter((command) => command !== null);
  if (verificationHeadings.length === 1 && commands.length === 0) return null;
  return { oldText, newText, commands };
}

function hasUnambiguousTrustedPatchContext(request) {
  return trustedExactPatchContext(request) !== null;
}

function parseArgs(argv) {
  const args = { repo: defaultRepoRoot, dispatch: false, request: null };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo') args.repo = path.resolve(argv[++index]);
    else if (arg === '--dispatch') args.dispatch = true;
    else if (arg === '--request') args.request = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function gitDirtyFiles(repoRoot, run = spawnSync) {
  const result = run('git', ['status', '--porcelain=v1', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) return { ok: false, files: [] };
  const records = String(result.stdout ?? '').split('\0');
  const files = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const status = record.slice(0, 2);
    const firstPath = record.slice(3);
    if (firstPath) files.push(firstPath);
    // In porcelain v1 -z output, rename/copy records carry both the new and
    // old path as NUL-delimited records.  Checking only one lets a source
    // path be hidden by a rename to or from .brownie/.
    if (status.includes('R') || status.includes('C')) {
      const secondPath = records[++index];
      if (secondPath) files.push(secondPath);
    }
  }
  return {
    ok: true,
    files: [...new Set(files)]
  };
}

function isBrownieManagedPath(file) {
  return file === '.brownie'
    || file.startsWith('.brownie/')
    || file.endsWith('/.brownie')
    || file.includes('/.brownie/');
}

function hasExactlyOneOccurrence(text, needle) {
  const first = text.indexOf(needle);
  return first >= 0 && first === text.lastIndexOf(needle);
}

// A recovery worker can atomically apply the requested hunk and then stop
// before it records completion. Ordinarily a source change blocks another
// worker. The sole exception is the request-declared target while it still
// holds exactly the trusted preimage; applyTrustedExactPatch validates and
// atomically replaces that hunk before any controller write is accepted.
function trustedDirtyTargetState({ repoRoot, targetPaths, context, files }) {
  if (!context || targetPaths.length !== 1 || files.length !== 1 || files[0] !== targetPaths[0]) return null;
  const targetPath = targetPaths[0];
  if (isBrownieManagedPath(targetPath) || path.isAbsolute(targetPath) || targetPath.split('/').includes('..')) return null;
  try {
    const root = fs.realpathSync(repoRoot);
    const absolute = path.resolve(root, targetPath);
    const stat = fs.lstatSync(absolute);
    const real = fs.realpathSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || !isWithinRepo(root, real)) return null;
    const text = fs.readFileSync(real, 'utf8');
    if (hasExactlyOneOccurrence(text, context.oldText)) return 'preimage';
    if (hasExactlyOneOccurrence(text, context.newText)) return 'postimage';
    return null;
  } catch {
    return null;
  }
}

function isTrustedDirtyTargetOnly(options) {
  return trustedDirtyTargetState(options) !== null;
}

function requestFailure(reason, extra = {}) {
  return { eligible: false, reason, ...extra };
}

function selfUpdateTargetPaths(request) {
  const targetLine = request
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.startsWith('Allowed paths:'));
  if (!targetLine) return [];
  return [...new Set([...targetLine.matchAll(/`([^`]+)`/gu)]
    .map((match) => match[1].trim())
    .filter((candidate) => candidate.length > 0
      && !path.isAbsolute(candidate)
      && !candidate.split('/').includes('..')))].sort();
}

function privateProviderEnvironment(repoRoot) {
  const envPath = path.join(repoRoot, '.brownie', 'private', 'llm.env');
  let text;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, source: 'process_environment', values: {} };
    return { ok: false, reason: 'private_provider_env_unreadable' };
  }
  const values = {};
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match) return { ok: false, reason: 'private_provider_env_invalid' };
    const [, key, rawValue] = match;
    if (!(/^(BROWNIE_(?:LLM|CLI|RUNTIME)_)[A-Z0-9_]*$/u.test(key) || key === 'OPENAI_API_KEY')) {
      return { ok: false, reason: 'private_provider_env_key_forbidden' };
    }
    const value = rawValue.trim();
    if ((value.startsWith('"') && !value.endsWith('"'))
      || (value.startsWith("'") && !value.endsWith("'"))) {
      return { ok: false, reason: 'private_provider_env_invalid' };
    }
    values[key] = (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
      ? value.slice(1, -1)
      : value;
  }
  return { ok: true, source: 'private_provider_environment', values };
}

function recoveryWorkerEnvironment(providerEnvironment) {
  return {
    ...process.env,
    ...providerEnvironment.values,
    PHASE_LOOP_SELF_UPDATE_ACTIVE: '1',
    // This must be assigned after the private file is read: a private or
    // inherited read-only mode must not downgrade a recovery write task.
    BROWNIE_CLI_RUN_MODE_ID: 'implementer'
  };
}

function selfUpdateStatePath(repoRoot) {
  return path.join(repoRoot, '.brownie/private/phase-loop/self-update/retry-state.json');
}

function selfUpdateFingerprint({ request, eligibility }) {
  const payload = JSON.stringify({
    request: request.trim(),
    status: eligibility.diagnostic?.phase_loop?.status ?? null,
    issue_codes: (eligibility.diagnostic?.issues ?? []).map((issue) => issue.code).sort()
  });
  return `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`;
}

function retryDelayMs(failedAttempts) {
  return Math.min(retryBaseDelayMs * (2 ** Math.max(0, failedAttempts - 1)), retryMaxDelayMs);
}

function readRetryState(repoRoot) {
  const state = readJson(selfUpdateStatePath(repoRoot));
  return state && state.schema_version === 1 && typeof state.fingerprints === 'object'
    ? state
    : { schema_version: 1, kind: 'brownie_phase_loop_self_update_retry_state', fingerprints: {} };
}

function retryDecision({ repoRoot, request, eligibility, now }) {
  const state = readRetryState(repoRoot);
  const fingerprint = selfUpdateFingerprint({ request, eligibility });
  const entry = state.fingerprints[fingerprint] ?? null;
  const currentTime = now().getTime();
  if (!entry || entry.status !== 'failed') return { allowed: true, fingerprint, state, entry };
  if (entry.failed_attempts >= maxAttemptsPerFingerprint) {
    return { allowed: false, reason: 'self_update_retry_budget_exhausted', fingerprint, state, entry, max_attempts: maxAttemptsPerFingerprint };
  }
  const retryAfter = Date.parse(entry.retry_after ?? '');
  if (Number.isFinite(retryAfter) && currentTime < retryAfter) {
    return { allowed: false, reason: 'self_update_retry_backoff_active', fingerprint, state, entry, retry_after: entry.retry_after };
  }
  return { allowed: true, fingerprint, state, entry };
}

function persistRetryState(repoRoot, state) {
  writeAtomically(selfUpdateStatePath(repoRoot), `${JSON.stringify(state, null, 2)}\n`);
}

function providerFailure(reason, brownieRuntimeBin, diagnostic, detail = null) {
  return requestFailure('implementation_provider_unavailable', {
    provider_reason: reason,
    brownie_runtime_bin: brownieRuntimeBin,
    diagnostic,
    ...(detail ? { provider_detail: detail } : {})
  });
}

function implementationProviderEligibility({ repoRoot, brownieRuntimeBin, diagnostic, run, workerEnv }) {
  if (!fs.existsSync(brownieRuntimeBin)) {
    return providerFailure('runtime_binary_missing', brownieRuntimeBin, diagnostic);
  }
  const result = run(brownieRuntimeBin, [], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: '{"jsonrpc":"2.0","id":1,"method":"llm.status"}\n',
    env: workerEnv
  });
  if (result.status !== 0 || result.signal) {
    return providerFailure('runtime_status_unavailable', brownieRuntimeBin, diagnostic);
  }

  let status;
  try {
    status = JSON.parse(String(result.stdout ?? '').trim())?.result;
  } catch {
    return providerFailure('runtime_status_invalid', brownieRuntimeBin, diagnostic);
  }
  if (!status || typeof status !== 'object') {
    return providerFailure('runtime_status_invalid', brownieRuntimeBin, diagnostic);
  }
  const detail = {
    provider: typeof status.provider === 'string' ? status.provider : null,
    enabled: status.enabled === true,
    strict: status.strict === true,
    will_fallback_to_fake: status.will_fallback_to_fake === true,
    llm_provider_access_allowed: status.llm_provider_access_allowed === true,
    task_run_network_allowed: status.task_run_network_allowed === true
  };
  if (detail.provider === 'Fake' || detail.provider === null) {
    return providerFailure('fake_provider_forbidden', brownieRuntimeBin, diagnostic, detail);
  }
  if (!detail.enabled || !detail.strict || detail.will_fallback_to_fake
    || !detail.llm_provider_access_allowed || !detail.task_run_network_allowed) {
    return providerFailure('provider_not_permitted_for_implementation', brownieRuntimeBin, diagnostic, detail);
  }
  return { eligible: true, brownie_runtime_bin: brownieRuntimeBin, implementation_provider: detail };
}

export function evaluateSelfUpdateEligibility({ repoRoot, request, run = spawnSync }) {
  if (typeof request !== 'string' || request.trim().length === 0) {
    return requestFailure('self_update_request_missing');
  }
  if (Buffer.byteLength(request, 'utf8') > maxRequestBytes) {
    return requestFailure('self_update_request_too_large', { max_request_bytes: maxRequestBytes });
  }
  const targetPaths = selfUpdateTargetPaths(request);
  if (targetPaths.length === 0) {
    return requestFailure('self_update_targets_missing', {
      required_request_field: 'Allowed paths: `workspace-relative/path`'
    });
  }

  const diagnostic = diagnosePhaseLoop({ repoRoot, write: false });
  const status = diagnostic.phase_loop?.status;
  const running = diagnostic.phase_loop?.running === true;
  if (running || !['no_progress', 'blocked', 'stopped'].includes(status)) {
    return requestFailure('phase_loop_not_stopped_for_self_update', { status, running, diagnostic });
  }

  const dirty = gitDirtyFiles(repoRoot, run);
  if (!dirty.ok) return requestFailure('git_status_unavailable', { diagnostic });
  const nonBrownieDirtyFiles = dirty.files.filter((file) => !isBrownieManagedPath(file));
  const trustedContext = trustedExactPatchContext(request);
  const trustedTargetDirtyOnly = isTrustedDirtyTargetOnly({
    repoRoot,
    targetPaths,
    context: trustedContext,
    files: nonBrownieDirtyFiles
  });
  if (nonBrownieDirtyFiles.length > 0 && !trustedTargetDirtyOnly) {
    return requestFailure('non_brownie_workspace_changes_present', { non_brownie_dirty_files: nonBrownieDirtyFiles, diagnostic });
  }

  const providerEnvironment = privateProviderEnvironment(repoRoot);
  const brownieBin = process.env.BROWNIE_BIN || path.join(repoRoot, 'target/debug/brownie');
  if (!fs.existsSync(brownieBin)) return requestFailure('brownie_binary_missing', { brownie_bin: brownieBin, diagnostic });
  if (!providerEnvironment.ok) {
    const brownieRuntimeBin = process.env.BROWNIE_RUNTIME_PATH || path.join(repoRoot, 'target/debug/brownie-runtime');
    return providerFailure(providerEnvironment.reason, brownieRuntimeBin, diagnostic);
  }
  const workerEnv = recoveryWorkerEnvironment(providerEnvironment);
  const configuredRuntimeBin = workerEnv.BROWNIE_RUNTIME_PATH || path.join(repoRoot, 'target/debug/brownie-runtime');
  const brownieRuntimeBin = path.isAbsolute(configuredRuntimeBin)
    ? configuredRuntimeBin
    : path.resolve(repoRoot, configuredRuntimeBin);
  workerEnv.BROWNIE_RUNTIME_PATH = brownieRuntimeBin;
  const provider = implementationProviderEligibility({ repoRoot, brownieRuntimeBin, diagnostic, run, workerEnv });
  if (!provider.eligible) return provider;

  const eligibility = {
    eligible: true,
    brownie_bin: brownieBin,
    brownie_runtime_bin: brownieRuntimeBin,
    implementation_provider: provider.implementation_provider,
    provider_environment: providerEnvironment.source,
    target_paths: targetPaths,
    dirty_brownie_files: dirty.files,
    trusted_target_dirty_only: trustedTargetDirtyOnly,
    diagnostic
  };
  // Keep credentials out of CLI/diagnostic JSON while making preflight and
  // dispatch use the same immutable child environment.
  Object.defineProperty(eligibility, 'worker_env', { value: workerEnv, enumerable: false });
  return eligibility;
}

export function buildSelfUpdateObjective({ request, eligibility }) {
  const issueCodes = (eligibility.diagnostic?.issues ?? []).map((issue) => issue.code).join(', ') || 'none';
  const status = eligibility.diagnostic?.phase_loop?.status ?? 'unknown';
  const targetPaths = eligibility.target_paths ?? [];
  const hasTrustedPatchContext = hasUnambiguousTrustedPatchContext(request);
  const trustedPatchInstruction = hasTrustedPatchContext
    ? 'read_budget_repair_policy: trusted exact patch context is embedded below. The recovery request supplies an exact trusted patch context. Do not use workspace.read to rediscover that hunk; emit the compact workspace.write patch_file directly so a large target file cannot truncate the recovery context.\n\n'
    : '';
  const requiredOutcome = hasTrustedPatchContext
    ? '1. Apply only the supplied exact patch to the declared target; do not widen it or rediscover its contents.\n2. Run exactly the supplied trusted verification commands and report their results.\n3. Do not stage, overwrite, revert, or delete pre-existing .brownie/ changes.\n4. Do not restart the normal phase loop. Finish with a concise summary suitable for a brownie-agent-authored PR.'
    : '1. Implement only the minimum controller/runtime change that removes the diagnosed contradiction.\n2. Add a regression test that proves the recovery path works and retain the denial test for the unsafe path.\n3. Run the smallest relevant tests and report exact commands/results.\n4. Do not stage, overwrite, revert, or delete pre-existing .brownie/ changes.\n5. Do not restart the normal phase loop. Finish with a concise summary suitable for a brownie-agent-authored PR.';
  return `# Brownie controller self-update recovery\n\nYou are the dedicated Brownie recovery implementer. The normal phase loop is stopped. Runtime permissions and the bounded target contract below override this request.\n\n## Observed controller state\n\n- status: ${status}\n- diagnostic issue codes: ${issueCodes}\n- preserved Brownie state files: ${(eligibility.dirty_brownie_files ?? []).join(', ') || '<none>'}\n\n## Selected TODO\n\n- [ ] phase-loop-self-update: Patch only ${targetPaths.map((target) => `\`${target}\``).join(' and ')}.\n  Route: implementation.\n  Source TODO: phase-loop-self-update.\n  Depends on: <none>.\n  Completion condition: the diagnosed controller contradiction is removed without changing operational state.\n  Forbidden changes: do not edit \`.brownie/todo.md\`, \`.brownie/todo-breakdown.md\`, or any pre-existing \`.brownie/**\` state.\n  Verification: run the smallest targeted regression tests for the changed file.\n\n## Recovery request\n\n${request.trim()}\n\n${trustedPatchInstruction}## Required outcome\n\n${requiredOutcome}\n`;
}

function writeAtomically(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function isWithinRepo(repoRoot, candidate) {
  return candidate !== repoRoot && candidate.startsWith(`${repoRoot}${path.sep}`);
}

function trustedVerificationArgs(command) {
  if (command === 'cargo fmt --check') {
    return { program: 'cargo', args: ['fmt', '--check'], requires_test_execution: false };
  }
  if (command === 'cargo test -p brownie-runtime --all-features') {
    return { program: 'cargo', args: ['test', '-p', 'brownie-runtime', '--all-features'], requires_test_execution: true };
  }
  if (command === 'pnpm --workspace-root guard:runtime-release-readiness') {
    return { program: 'pnpm', args: ['--workspace-root', 'guard:runtime-release-readiness'], requires_test_execution: false };
  }
  if (command === 'pnpm --workspace-root guard:runtime-release-readiness:test') {
    return {
      program: 'pnpm',
      args: ['--workspace-root', 'guard:runtime-release-readiness:test'],
      requires_test_execution: true,
      test_evidence: /(?:#|\u2139)\s*tests\s+[1-9]\d*\b/u
    };
  }
  if (command === 'pnpm --workspace-root guard:release-contract') {
    return { program: 'pnpm', args: ['--workspace-root', 'guard:release-contract'], requires_test_execution: false };
  }
  if (command === 'pnpm --workspace-root guard:release-contract:test') {
    return {
      program: 'pnpm',
      args: ['--workspace-root', 'guard:release-contract:test'],
      requires_test_execution: true,
      test_evidence: /(?:#|\u2139)\s*tests\s+[1-9]\d*\b/u
    };
  }
  if (command === 'git diff --check') {
    return { program: 'git', args: ['diff', '--check'], requires_test_execution: false };
  }
  const match = /^cargo test -p ([a-z0-9-]+)(?: ([A-Za-z0-9_:-]+))?$/u.exec(command);
  if (!match) return null;
  const args = ['test', '-p', match[1]];
  if (match[2]) args.push(match[2]);
  return { program: 'cargo', args, requires_test_execution: true };
}

function runTrustedVerification({ repoRoot, commands, run }) {
  const results = [];
  for (const command of commands) {
    const invocation = trustedVerificationArgs(command);
    if (!invocation) {
      return { ok: false, reason: 'trusted_verification_command_forbidden', results, command };
    }
    const { program, args } = invocation;
    const result = run(program, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 10 * 60_000,
      maxBuffer: 256 * 1024
    });
    const entry = {
      command,
      exit_code: result.status,
      signal: result.signal ?? null,
      stdout: String(result.stdout ?? '').slice(-12_000),
      stderr: String(result.stderr ?? '').slice(-12_000)
    };
    results.push(entry);
    if (result.status !== 0 || result.signal) {
      return { ok: false, reason: 'trusted_verification_failed', results };
    }
    const testEvidence = invocation.test_evidence ?? /(?:\brunning [1-9]\d* tests?\b|\btest result: ok\. [1-9]\d* passed\b)/u;
    if (invocation.requires_test_execution
      && !testEvidence.test(`${entry.stdout}\n${entry.stderr}`)) {
      return { ok: false, reason: 'trusted_verification_no_tests_run', results };
    }
  }
  return { ok: true, results };
}

function writeSourceAtomically(filePath, contents, mode) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode });
  fs.renameSync(temporary, filePath);
}

export function applyTrustedExactPatch({ repoRoot, targetPath, context, run = spawnSync }) {
  if (!context || typeof context.oldText !== 'string' || typeof context.newText !== 'string') {
    return { applied: false, reason: 'trusted_patch_context_invalid' };
  }
  if (isBrownieManagedPath(targetPath) || path.isAbsolute(targetPath) || targetPath.split('/').includes('..')) {
    return { applied: false, reason: 'trusted_patch_target_forbidden' };
  }
  let realRepoRoot;
  try {
    realRepoRoot = fs.realpathSync(repoRoot);
  } catch {
    return { applied: false, reason: 'trusted_patch_repo_unreadable' };
  }
  const absolute = path.resolve(realRepoRoot, targetPath);
  if (!isWithinRepo(realRepoRoot, absolute)) return { applied: false, reason: 'trusted_patch_target_outside_repo' };

  let stat;
  let real;
  let before;
  try {
    stat = fs.lstatSync(absolute);
    real = fs.realpathSync(absolute);
    before = fs.readFileSync(absolute, 'utf8');
  } catch {
    return { applied: false, reason: 'trusted_patch_target_unreadable' };
  }
  const canonicalRelative = path.relative(realRepoRoot, real);
  if (!stat.isFile()
    || stat.isSymbolicLink()
    || !isWithinRepo(realRepoRoot, real)
    || isBrownieManagedPath(canonicalRelative)) {
    return { applied: false, reason: 'trusted_patch_target_unsafe' };
  }

  const first = before.indexOf(context.oldText);
  const last = before.lastIndexOf(context.oldText);
  if (first < 0) return { applied: false, reason: 'trusted_patch_old_text_missing' };
  if (first !== last) return { applied: false, reason: 'trusted_patch_old_text_ambiguous' };

  const after = `${before.slice(0, first)}${context.newText}${before.slice(first + context.oldText.length)}`;
  writeSourceAtomically(absolute, after, stat.mode & 0o777);
  const verification = runTrustedVerification({ repoRoot, commands: context.commands, run });
  if (!verification.ok) {
    const current = fs.readFileSync(absolute, 'utf8');
    if (current === after) {
      writeSourceAtomically(absolute, before, stat.mode & 0o777);
      return { applied: false, reason: verification.reason, verification, restored: true };
    }
    return { applied: false, reason: `${verification.reason}_restore_refused`, verification, restored: false };
  }
  return {
    applied: true,
    target_path: targetPath,
    verification,
    before_sha256: `sha256:${crypto.createHash('sha256').update(before).digest('hex')}`,
    after_sha256: `sha256:${crypto.createHash('sha256').update(after).digest('hex')}`
  };
}

function selfUpdateOutcome(result) {
  if (result.status !== 0) return { ok: false, reason: 'process_exit_nonzero' };
  if (result.signal) return { ok: false, reason: 'process_signaled' };

  let payload;
  try {
    payload = JSON.parse(String(result.stdout ?? '').trim());
  } catch {
    return { ok: false, reason: 'cli_json_invalid' };
  }

  const automation = payload?.automation ?? payload?.run?.automation;
  if (payload?.ok !== true || !automation || typeof automation !== 'object') {
    return { ok: false, reason: 'cli_outcome_missing' };
  }
  if (automation.terminal_failure === true) {
    return { ok: false, reason: 'cli_terminal_failure' };
  }
  if (automation.continuation_required === true) {
    return { ok: false, reason: 'cli_continuation_required' };
  }
  if (['no_actionable_work', 'no_eligible_work'].includes(automation.status)) {
    return { ok: false, reason: 'cli_no_actionable_work' };
  }
  if (automation.blocked === true) return { ok: false, reason: 'cli_blocked' };
  if (automation.completed !== true || automation.status !== 'completed' || automation.controller_action !== 'stop') {
    return { ok: false, reason: 'cli_outcome_not_completed' };
  }
  return { ok: true, reason: 'completed' };
}

function appliedRecoveryContinuationScope(result) {
  if (result.status !== 0 || result.signal) return null;
  let payload;
  try {
    payload = JSON.parse(String(result.stdout ?? '').trim());
  } catch {
    return null;
  }
  const run = payload?.run;
  const automation = run?.automation;
  if (!automation
    || automation.continuation_required !== true
    || automation.controller_action !== 'resume'
    || run?.objective_apply_applied !== true) {
    return null;
  }
  const scope = {
    session_id: run.session_id,
    journey_id: run.journey_id,
    task_id: run.task_id,
    run_id: run.run_id
  };
  return Object.values(scope).every((value) => typeof value === 'string' && value.trim().length > 0)
    ? scope
    : null;
}

function resumeAppliedRecovery({ brownieBin, repoRoot, workerEnv, run, scope }) {
  return run(brownieBin, [
    '--json',
    'resume',
    '--session-id', scope.session_id,
    '--journey-id', scope.journey_id,
    '--task-id', scope.task_id,
    '--run-id', scope.run_id
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: workerEnv
  });
}

function isSameScopedContinuation(result, scope) {
  if (result.status !== 0 || result.signal) return false;
  try {
    const run = JSON.parse(String(result.stdout ?? '').trim())?.run;
    const automation = run?.automation;
    return automation?.continuation_required === true
      && automation.controller_action === 'resume'
      && ['session_id', 'journey_id', 'task_id', 'run_id'].every((key) => run?.[key] === scope[key]);
  } catch {
    return false;
  }
}

export function dispatchSelfUpdate({ repoRoot, request, run = spawnSync, now = () => new Date() }) {
  const eligibility = evaluateSelfUpdateEligibility({ repoRoot, request, run });
  if (!eligibility.eligible) return { dispatched: false, eligibility };
  const retry = retryDecision({ repoRoot, request, eligibility, now });
  if (!retry.allowed) {
    return {
      dispatched: false,
      eligibility,
      retry: {
        allowed: false,
        reason: retry.reason,
        fingerprint: retry.fingerprint,
        retry_after: retry.retry_after ?? null,
        failed_attempts: retry.entry?.failed_attempts ?? 0,
        max_attempts: retry.max_attempts ?? maxAttemptsPerFingerprint
      }
    };
  }

  const stamp = now().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
  const stateDir = path.join(repoRoot, '.brownie/private/phase-loop/self-update');
  const objectivePath = path.join(stateDir, `${stamp}.objective.md`);
  const resultPath = path.join(stateDir, `${stamp}.result.json`);
  const objective = buildSelfUpdateObjective({ request, eligibility });
  writeAtomically(objectivePath, objective);

  const initialResult = run(eligibility.brownie_bin, ['--json', 'run', '--file', objectivePath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: eligibility.worker_env
  });
  const continuationScope = appliedRecoveryContinuationScope(initialResult);
  let result = initialResult;
  let resumeAttempts = 0;
  while (continuationScope && resumeAttempts < maxAppliedRecoveryResumes) {
    result = resumeAppliedRecovery({
      brownieBin: eligibility.brownie_bin,
      repoRoot,
      workerEnv: eligibility.worker_env,
      run,
      scope: continuationScope
    });
    resumeAttempts += 1;
    if (!isSameScopedContinuation(result, continuationScope)) break;
  }
  let outcome = selfUpdateOutcome(result);
  let deterministicTrustedPatch = null;
  const trustedContext = trustedExactPatchContext(request);
  if (!outcome.ok && trustedContext && trustedContext.commands.length > 0 && eligibility.target_paths.length === 1) {
    const currentDirty = gitDirtyFiles(repoRoot, run);
    const trustedTargetState = currentDirty.ok
      ? trustedDirtyTargetState({
        repoRoot,
        targetPaths: eligibility.target_paths,
        context: trustedContext,
        files: currentDirty.files.filter((file) => !isBrownieManagedPath(file))
      })
      : null;
    const sourceTreeStillClean = currentDirty.ok
      && (currentDirty.files.every((file) => isBrownieManagedPath(file))
        || trustedTargetState !== null);
    if (!sourceTreeStillClean) {
      deterministicTrustedPatch = {
        applied: false,
        reason: 'trusted_patch_source_tree_changed_during_worker'
      };
    } else if (trustedTargetState === 'postimage') {
      const verification = runTrustedVerification({
        repoRoot,
        commands: trustedContext.commands,
        run
      });
      deterministicTrustedPatch = {
        applied: verification.ok,
        verified_existing_patch: true,
        target_path: eligibility.target_paths[0],
        verification
      };
      if (verification.ok) {
        outcome = { ok: true, reason: 'trusted_exact_patch_verified_after_worker_stop' };
      }
    } else {
      deterministicTrustedPatch = applyTrustedExactPatch({
        repoRoot,
        targetPath: eligibility.target_paths[0],
        context: trustedContext,
        run
      });
      if (deterministicTrustedPatch.applied) {
        outcome = { ok: true, reason: 'trusted_exact_patch_applied_after_worker_failure' };
      }
    }
  }
  const record = {
    schema_version: 1,
    kind: 'brownie_phase_loop_self_update_dispatch',
    dispatched_at: now().toISOString(),
    objective_path: path.relative(repoRoot, objectivePath),
    exit_code: result.status,
    signal: result.signal ?? null,
    outcome: outcome.reason,
    continuation: continuationScope
      ? { attempted: true, scope: continuationScope, initial_exit_code: initialResult.status, resume_attempts: resumeAttempts, exhausted: resumeAttempts === maxAppliedRecoveryResumes && isSameScopedContinuation(result, continuationScope) }
      : { attempted: false },
    deterministic_trusted_patch: deterministicTrustedPatch,
    stdout: String(result.stdout ?? '').slice(-12_000),
    stderr: String(result.stderr ?? '').slice(-12_000),
    dirty_brownie_files_preserved: eligibility.dirty_brownie_files
  };
  writeAtomically(resultPath, `${JSON.stringify(record, null, 2)}\n`);
  const previousFailures = retry.entry?.failed_attempts ?? 0;
  const failedAttempts = outcome.ok ? 0 : previousFailures + 1;
  const nextRetryAt = outcome.ok
    ? null
    : new Date(now().getTime() + retryDelayMs(failedAttempts)).toISOString();
  retry.state.fingerprints[retry.fingerprint] = {
    fingerprint: retry.fingerprint,
    status: outcome.ok ? 'succeeded' : 'failed',
    request_sha256: crypto.createHash('sha256').update(request.trim()).digest('hex'),
    failed_attempts: failedAttempts,
    max_attempts: maxAttemptsPerFingerprint,
    last_attempt_at: record.dispatched_at,
    retry_after: nextRetryAt,
    last_result_path: path.relative(repoRoot, resultPath),
    last_exit_code: result.status,
    last_outcome: outcome.reason,
    exhausted: !outcome.ok && failedAttempts >= maxAttemptsPerFingerprint
  };
  persistRetryState(repoRoot, retry.state);
  return {
    dispatched: true,
    ok: outcome.ok,
    objective_path: record.objective_path,
    result_path: path.relative(repoRoot, resultPath),
    exit_code: result.status,
    retry: {
      fingerprint: retry.fingerprint,
      failed_attempts: failedAttempts,
      max_attempts: maxAttemptsPerFingerprint,
      retry_after: nextRetryAt,
      exhausted: !outcome.ok && failedAttempts >= maxAttemptsPerFingerprint
    },
    diagnostic: eligibility.diagnostic
  };
}

if (process.argv[1] === __filename) {
  const args = parseArgs(process.argv);
  const result = args.dispatch
    ? dispatchSelfUpdate({ repoRoot: args.repo, request: args.request })
    : { dispatched: false, eligibility: evaluateSelfUpdateEligibility({ repoRoot: args.repo, request: args.request }) };
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.dispatched && result.ok === false ? 1 : result.eligibility?.eligible === false ? 2 : 0);
}
