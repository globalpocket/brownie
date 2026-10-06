#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(repoRoot, args, options = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: options.encoding ?? 'utf8',
    stdio: ['ignore', 'pipe', options.quiet ? 'ignore' : 'pipe']
  });
}

function tryGit(repoRoot, args, options = {}) {
  try {
    return git(repoRoot, args, options);
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = { repo: defaultRepoRoot, target: 'origin/main', write: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    else if (arg === '--repo') args.repo = path.resolve(argv[++index]);
    else if (arg === '--target') args.target = argv[++index];
    else if (arg === '--write') args.write = true;
    else if (arg === '--no-write') args.write = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function statusEntries(repoRoot) {
  const output = git(repoRoot, ['status', '--porcelain=v1', '-z']);
  return output.split('\0').filter(Boolean).map((entry) => ({
    status: entry.slice(0, 2),
    path: entry.slice(3)
  }));
}

function blobAt(repoRoot, revision, filePath) {
  return tryGit(repoRoot, ['rev-parse', `${revision}:${filePath}`], { quiet: true })?.trim() ?? null;
}

function worktreeBlob(repoRoot, filePath) {
  if (!fs.existsSync(path.join(repoRoot, filePath))) return null;
  return git(repoRoot, ['hash-object', '--', filePath]).trim();
}

function indexBlob(repoRoot, filePath) {
  return tryGit(repoRoot, ['rev-parse', `:${filePath}`], { quiet: true })?.trim() ?? null;
}

function blobExistsInDeliveredRange(repoRoot, head, target, filePath, blob) {
  if (!blob) return false;
  const commits = tryGit(repoRoot, ['log', '--format=%H', '--find-object', blob, `${head}..${target}`, '--', filePath], { quiet: true });
  return typeof commits === 'string' && commits.trim().length > 0;
}

function isDeliveredBlob({ blob, targetBlob, repoRoot, head, targetCommit, filePath }) {
  return blob === null || blob === targetBlob || blobExistsInDeliveredRange(repoRoot, head, targetCommit, filePath, blob);
}

function targetChangedPaths(repoRoot, head, targetCommit) {
  return git(repoRoot, ['diff', '--name-only', '-z', head, targetCommit])
    .split('\0')
    .filter(Boolean);
}

export function diagnoseDeliveryReconciliation({ repoRoot, target = 'origin/main' }) {
  const head = git(repoRoot, ['rev-parse', 'HEAD']).trim();
  const targetCommit = git(repoRoot, ['rev-parse', target]).trim();
  const branch = tryGit(repoRoot, ['symbolic-ref', '--short', 'HEAD'], { quiet: true })?.trim() ?? null;
  const headIsAncestor = tryGit(repoRoot, ['merge-base', '--is-ancestor', head, targetCommit], { quiet: true }) !== null;
  const files = statusEntries(repoRoot).map((entry) => {
    const worktree = worktreeBlob(repoRoot, entry.path);
    const index = indexBlob(repoRoot, entry.path);
    const targetBlob = blobAt(repoRoot, targetCommit, entry.path);
    let classification = 'unrelated_local_change';
    const indexSafe = isDeliveredBlob({ blob: index, targetBlob, repoRoot, head, targetCommit, filePath: entry.path });
    const worktreeSafe = isDeliveredBlob({ blob: worktree, targetBlob, repoRoot, head, targetCommit, filePath: entry.path });
    if (!index && !worktree && !targetBlob) classification = 'absent_both';
    else if (index === targetBlob && worktree === targetBlob) classification = 'merged_identical';
    else if (indexSafe && worktreeSafe) classification = 'known_delivery_history';
    return {
      ...entry,
      index_blob: index,
      worktree_blob: worktree,
      target_blob: targetBlob,
      classification
    };
  });
  const blockers = [];
  if (!branch) blockers.push({ code: 'detached_head', message: 'Delivery reconciliation requires an attached branch.' });
  if (!headIsAncestor) blockers.push({ code: 'target_not_fast_forward', message: `${head} is not an ancestor of ${targetCommit}.` });
  for (const file of files) {
    if (!['merged_identical', 'known_delivery_history', 'absent_both'].includes(file.classification)) {
      blockers.push({ code: 'unrelated_local_change', path: file.path, status: file.status });
    }
  }
  return {
    schema_version: 1,
    kind: 'phase_loop_delivery_reconciliation',
    generated_at: new Date().toISOString(),
    repo_root: repoRoot,
    branch,
    head,
    target,
    target_commit: targetCommit,
    head_is_ancestor: headIsAncestor,
    target_changed_paths: targetChangedPaths(repoRoot, head, targetCommit),
    files,
    safe_to_reconcile: blockers.length === 0,
    blockers
  };
}

function writeReceipt(repoRoot, result) {
  const receiptDir = path.join(repoRoot, '.brownie/private/phase-loop/delivery-receipts');
  fs.mkdirSync(receiptDir, { recursive: true });
  const stamp = result.generated_at.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
  const receiptPath = path.join(receiptDir, `${stamp}-${result.target_commit.slice(0, 12)}.json`);
  fs.writeFileSync(receiptPath, `${JSON.stringify(result, null, 2)}\n`);
  return path.relative(repoRoot, receiptPath);
}

export function reconcileDelivery({ repoRoot, target = 'origin/main', write = false }) {
  const diagnosis = diagnoseDeliveryReconciliation({ repoRoot, target });
  if (!write || !diagnosis.safe_to_reconcile || diagnosis.head === diagnosis.target_commit) {
    return { ...diagnosis, applied: false, reason: write ? (diagnosis.head === diagnosis.target_commit ? 'already_reconciled' : 'blocked') : 'dry_run' };
  }

  git(repoRoot, ['read-tree', diagnosis.target_commit]);
  const targetPaths = diagnosis.target_changed_paths
    .filter((filePath) => blobAt(repoRoot, diagnosis.target_commit, filePath));
  const deletedPaths = diagnosis.target_changed_paths
    .filter((filePath) => !blobAt(repoRoot, diagnosis.target_commit, filePath));
  if (targetPaths.length > 0) git(repoRoot, ['checkout-index', '-f', '--', ...targetPaths]);
  for (const filePath of deletedPaths) {
    fs.rmSync(path.join(repoRoot, filePath), { force: true });
  }
  git(repoRoot, ['update-ref', `refs/heads/${diagnosis.branch}`, diagnosis.target_commit, diagnosis.head]);

  const remaining = statusEntries(repoRoot);
  const result = {
    ...diagnosis,
    applied: true,
    reconciled_at: new Date().toISOString(),
    previous_head: diagnosis.head,
    head: git(repoRoot, ['rev-parse', 'HEAD']).trim(),
    remaining_changes: remaining,
    clean: remaining.length === 0
  };
  result.receipt_path = writeReceipt(repoRoot, result);
  if (!result.clean) throw new Error(`Delivery reconciliation left ${remaining.length} changed path(s). Receipt: ${result.receipt_path}`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv);
  const result = reconcileDelivery({ repoRoot: args.repo, target: args.target, write: args.write });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.safe_to_reconcile) process.exitCode = 2;
}
