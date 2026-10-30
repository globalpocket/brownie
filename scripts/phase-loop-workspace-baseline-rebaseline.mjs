#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const controllerSourceManifestPath = 'scripts/phase-loop-controller-source-manifest.json';

function git(repoRoot, args, options = {}) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
}

function gitTrimmed(repoRoot, args) {
  return git(repoRoot, args).trim();
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function remoteTrackingRefParts(baselineRef) {
  const match = String(baselineRef).match(/^(?:refs\/remotes\/)?([^/]+)\/(.+)$/u);
  if (!match || match[1] === 'HEAD' || /^[0-9a-f]{40}$/u.test(String(baselineRef))) return null;
  return { remote: match[1], branch: match[2] };
}

function refreshRemoteTrackingBaseline(repoRoot, baselineRef) {
  const parts = remoteTrackingRefParts(baselineRef);
  if (!parts) return { required: false, refreshed: false };
  const refspec = `+refs/heads/${parts.branch}:refs/remotes/${parts.remote}/${parts.branch}`;
  try {
    git(repoRoot, ['fetch', '--no-tags', '--force', parts.remote, refspec]);
    return { required: true, refreshed: true, remote: parts.remote, branch: parts.branch };
  } catch (error) {
    return {
      required: true,
      refreshed: false,
      remote: parts.remote,
      branch: parts.branch,
      error: String(error?.message ?? error).slice(0, 1_000)
    };
  }
}

function isAncestor(repoRoot, ancestor, descendant) {
  try {
    execFileSync('git', ['-C', repoRoot, 'merge-base', '--is-ancestor', ancestor, descendant], {
      stdio: 'ignore'
    });
    return true;
  } catch {
    return false;
  }
}

function normalizePath(candidate) {
  return String(candidate).replace(/^\.\/+/, '').replace(/\/+$/u, '');
}

function pathsOverlap(left, right) {
  const normalizedLeft = normalizePath(left);
  const normalizedRight = normalizePath(right);
  return normalizedLeft === normalizedRight
    || normalizedLeft.startsWith(`${normalizedRight}/`)
    || normalizedRight.startsWith(`${normalizedLeft}/`);
}

function parsePorcelainStatus(rawStatus) {
  const records = String(rawStatus).split('\0');
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const status = record.slice(0, 2);
    const paths = [record.slice(3)].filter(Boolean);
    if (status.includes('R') || status.includes('C')) {
      const sourcePath = records[++index];
      if (sourcePath) paths.push(sourcePath);
    }
    entries.push({ status, paths: [...new Set(paths.map(normalizePath))].sort() });
  }
  return entries;
}

function workspaceStatus(repoRoot) {
  const raw = git(repoRoot, ['status', '--porcelain=v1', '-z']);
  const entries = parsePorcelainStatus(raw);
  const paths = [...new Set(entries.flatMap((entry) => entry.paths))].sort();
  return { raw, fingerprint: sha256(raw), entries, paths };
}

function readControllerSourcePaths(repoRoot) {
  const manifestPath = path.join(repoRoot, controllerSourceManifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest?.schema_version !== 1 || !Array.isArray(manifest.controller_source_paths)) {
    throw new Error(`${controllerSourceManifestPath} is not a valid controller source manifest`);
  }
  const sourcePaths = manifest.controller_source_paths.map(normalizePath);
  if (sourcePaths.length === 0 || sourcePaths.some((value) => !value || value.startsWith('/') || value.includes('..'))) {
    throw new Error(`${controllerSourceManifestPath} contains invalid controller source paths`);
  }
  return [...new Set([controllerSourceManifestPath, ...sourcePaths])].sort();
}

function workspaceBranch(repoRoot) {
  try {
    return gitTrimmed(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  } catch {
    return null;
  }
}

function hasUnmergedEntries(repoRoot) {
  return gitTrimmed(repoRoot, ['ls-files', '-u']).length > 0;
}

function changedPathsBetween(repoRoot, fromRef, toRef) {
  const raw = git(repoRoot, ['diff', '--name-only', '-z', `${fromRef}..${toRef}`]);
  return [...new Set(raw.split('\0').filter(Boolean).map(normalizePath))].sort();
}

function commitTreeId(repoRoot, commit) {
  return gitTrimmed(repoRoot, ['rev-parse', '--verify', `${commit}^{tree}`]);
}

function timestampForFile(now) {
  return now.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
}

function safeRunStamp(value, now) {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,80}$/u.test(normalized) ? normalized : timestampForFile(now);
}

function writeAtomically(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  fs.writeFileSync(temporaryPath, value, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function errorResult(reason, details = {}) {
  return { ok: false, schema_version: 1, rebaselined: false, reason, ...details };
}

function parseArgs(argv) {
  const args = {
    command: 'rebaseline',
    repo: defaultRepoRoot,
    baselineRef: 'origin/main',
    stateDir: null,
    runStamp: null
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === 'rebaseline') args.command = arg;
    else if (arg === '--repo') args.repo = path.resolve(argv[++index]);
    else if (arg === '--baseline-ref') args.baselineRef = argv[++index];
    else if (arg === '--state-dir') args.stateDir = path.resolve(argv[++index]);
    else if (arg === '--run-stamp') args.runStamp = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.command !== 'rebaseline') throw new Error(`Unknown command: ${args.command}`);
  if (!args.stateDir) throw new Error('--state-dir is required');
  return args;
}

export function rebaselineWorkspaceToApprovedBaseline({
  repoRoot = defaultRepoRoot,
  baselineRef = 'origin/main',
  stateDir,
  runStamp = null,
  refreshBaseline = true,
  now = () => new Date()
} = {}) {
  if (!stateDir) return errorResult('state_dir_missing');
  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedStateDir = path.resolve(stateDir);
  const errors = [];
  let workspaceHead;
  let baselineCommit;
  let baselineRefresh = { required: false, refreshed: false };

  try {
    workspaceHead = gitTrimmed(resolvedRepoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
  } catch (error) {
    return errorResult('workspace_head_unavailable', { error: String(error?.message ?? error) });
  }
  if (refreshBaseline) {
    baselineRefresh = refreshRemoteTrackingBaseline(resolvedRepoRoot, baselineRef);
    if (baselineRefresh.required && !baselineRefresh.refreshed) {
      return errorResult('baseline_refresh_failed', {
        workspace_head: workspaceHead,
        baseline_ref: baselineRef,
        baseline_refresh: baselineRefresh
      });
    }
  }
  try {
    baselineCommit = gitTrimmed(resolvedRepoRoot, ['rev-parse', '--verify', `${baselineRef}^{commit}`]);
  } catch (error) {
    return errorResult('baseline_unavailable', {
      workspace_head: workspaceHead,
      baseline_ref: baselineRef,
      baseline_refresh: baselineRefresh,
      error: String(error?.message ?? error)
    });
  }

  if (isAncestor(resolvedRepoRoot, baselineCommit, workspaceHead)) {
    return {
      ok: true,
      schema_version: 1,
      rebaselined: false,
      reason: 'workspace_already_contains_approved_baseline',
      workspace_head: workspaceHead,
      baseline_ref: baselineRef,
      baseline_commit: baselineCommit,
      baseline_refresh: baselineRefresh
    };
  }
  const workspaceIsAncestorOfBaseline = isAncestor(resolvedRepoRoot, workspaceHead, baselineCommit);
  let workspaceTree = null;
  let baselineTree = null;
  if (!workspaceIsAncestorOfBaseline) {
    try {
      workspaceTree = commitTreeId(resolvedRepoRoot, workspaceHead);
      baselineTree = commitTreeId(resolvedRepoRoot, baselineCommit);
    } catch (error) {
      return errorResult('workspace_tree_unavailable', {
        workspace_head: workspaceHead,
        baseline_ref: baselineRef,
        baseline_commit: baselineCommit,
        baseline_refresh: baselineRefresh,
        error: String(error?.message ?? error)
      });
    }
    if (workspaceTree !== baselineTree) {
      return errorResult('workspace_history_diverged_from_approved_baseline', {
        workspace_head: workspaceHead,
        baseline_ref: baselineRef,
        baseline_commit: baselineCommit,
        baseline_refresh: baselineRefresh,
        workspace_tree: workspaceTree,
        baseline_tree: baselineTree
      });
    }
  }

  const branch = workspaceBranch(resolvedRepoRoot);
  if (!branch) {
    return errorResult('workspace_head_detached', {
      workspace_head: workspaceHead,
      baseline_ref: baselineRef,
      baseline_commit: baselineCommit,
      baseline_refresh: baselineRefresh
    });
  }
  if (hasUnmergedEntries(resolvedRepoRoot)) {
    return errorResult('workspace_has_unmerged_index_entries', {
      workspace_head: workspaceHead,
      baseline_ref: baselineRef,
      baseline_commit: baselineCommit,
      baseline_refresh: baselineRefresh,
      branch
    });
  }

  let controllerSourcePaths;
  try {
    controllerSourcePaths = readControllerSourcePaths(resolvedRepoRoot);
  } catch (error) {
    return errorResult('controller_source_manifest_invalid', {
      workspace_head: workspaceHead,
      baseline_ref: baselineRef,
      baseline_commit: baselineCommit,
      baseline_refresh: baselineRefresh,
      branch,
      error: String(error?.message ?? error)
    });
  }

  let dirtyBefore;
  let baselineDeltaPaths;
  try {
    dirtyBefore = workspaceStatus(resolvedRepoRoot);
    baselineDeltaPaths = changedPathsBetween(resolvedRepoRoot, workspaceHead, baselineCommit);
  } catch (error) {
    return errorResult('workspace_snapshot_failed', {
      workspace_head: workspaceHead,
      baseline_ref: baselineRef,
      baseline_commit: baselineCommit,
      baseline_refresh: baselineRefresh,
      branch,
      error: String(error?.message ?? error)
    });
  }

  const dirtyControllerPaths = dirtyBefore.paths.filter((dirtyPath) => controllerSourcePaths
    .some((controllerPath) => pathsOverlap(dirtyPath, controllerPath)));
  if (dirtyControllerPaths.length > 0) {
    return errorResult('dirty_controller_source_refuses_rebaseline', {
      workspace_head: workspaceHead,
      baseline_ref: baselineRef,
      baseline_commit: baselineCommit,
      baseline_refresh: baselineRefresh,
      branch,
      dirty_controller_paths: dirtyControllerPaths
    });
  }

  const overlappingDirtyPaths = dirtyBefore.paths.filter((dirtyPath) => baselineDeltaPaths
    .some((changedPath) => pathsOverlap(dirtyPath, changedPath)));
  if (overlappingDirtyPaths.length > 0) {
    return errorResult('dirty_paths_overlap_approved_baseline_delta', {
      workspace_head: workspaceHead,
      baseline_ref: baselineRef,
      baseline_commit: baselineCommit,
      baseline_refresh: baselineRefresh,
      branch,
      overlapping_dirty_paths: overlappingDirtyPaths
    });
  }

  const currentTime = now();
  const normalizedRunStamp = safeRunStamp(runStamp, currentTime);
  const controllerShellSourceChanged = baselineDeltaPaths.includes('phase-loop.sh');
  const historyTreeEquivalent = !workspaceIsAncestorOfBaseline;
  const auditId = `workspace-baseline-rebaseline-${normalizedRunStamp}-${sha256(`${workspaceHead}:${baselineCommit}:${dirtyBefore.fingerprint}`).slice(-12)}`;
  const auditPath = path.join(resolvedStateDir, 'workspace-baseline-rebaseline', `${auditId}.json`);
  const audit = {
    schema_version: 1,
    kind: 'brownie_phase_loop_workspace_baseline_rebaseline',
    audit_id: auditId,
    created_at: currentTime.toISOString(),
    run_stamp: normalizedRunStamp,
    workspace_root: resolvedRepoRoot,
    branch,
    baseline_ref: baselineRef,
    baseline_commit: baselineCommit,
    baseline_refresh: baselineRefresh,
    workspace_head_before: workspaceHead,
    workspace_tree: workspaceTree,
    baseline_tree: baselineTree,
    dirty_status_fingerprint_before: dirtyBefore.fingerprint,
    dirty_paths_before: dirtyBefore.paths,
    baseline_delta_paths: baselineDeltaPaths,
    controller_shell_source_changed: controllerShellSourceChanged,
    reconciliation_mode: historyTreeEquivalent ? 'tree_equivalent_history' : 'fast_forward',
    status: historyTreeEquivalent ? 'tree_equivalence_verifying' : 'started'
  };
  writeAtomically(auditPath, `${JSON.stringify(audit, null, 2)}\n`);

  if (historyTreeEquivalent) {
    let workspaceHeadAfter;
    let dirtyAfter;
    try {
      workspaceHeadAfter = gitTrimmed(resolvedRepoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
      dirtyAfter = workspaceStatus(resolvedRepoRoot);
    } catch (error) {
      audit.status = 'failed';
      audit.failure_reason = 'tree_equivalence_post_verification_failed';
      audit.error = String(error?.message ?? error).slice(0, 1_000);
      audit.completed_at = now().toISOString();
      writeAtomically(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
      return errorResult('tree_equivalence_post_verification_failed', { audit_path: auditPath });
    }
    audit.workspace_head_after = workspaceHeadAfter;
    audit.dirty_status_fingerprint_after = dirtyAfter.fingerprint;
    audit.dirty_paths_after = dirtyAfter.paths;
    audit.completed_at = now().toISOString();
    if (workspaceHeadAfter !== workspaceHead || dirtyAfter.fingerprint !== dirtyBefore.fingerprint) {
      audit.status = 'verification_failed';
      audit.failure_reason = workspaceHeadAfter !== workspaceHead
        ? 'workspace_head_changed_during_tree_equivalence_reconciliation'
        : 'dirty_workspace_changed_during_tree_equivalence_reconciliation';
      writeAtomically(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
      return errorResult(audit.failure_reason, {
        workspace_head_before: workspaceHead,
        workspace_head_after: workspaceHeadAfter,
        baseline_ref: baselineRef,
        baseline_commit: baselineCommit,
        branch,
        audit_path: auditPath
      });
    }
    audit.status = 'applied_tree_equivalence';
    writeAtomically(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
    return {
      ok: true,
      schema_version: 1,
      rebaselined: false,
      history_reconciled: true,
      baseline_equivalent: true,
      reason: 'workspace_tree_equivalent_to_approved_baseline',
      workspace_head_before: workspaceHead,
      workspace_head_after: workspaceHeadAfter,
      workspace_tree: workspaceTree,
      baseline_tree: baselineTree,
      baseline_ref: baselineRef,
      baseline_commit: baselineCommit,
      baseline_refresh: baselineRefresh,
      branch,
      controller_shell_reload_required: false,
      audit_path: auditPath
    };
  }

  try {
    git(resolvedRepoRoot, ['merge', '--ff-only', '--no-overwrite-ignore', baselineCommit]);
  } catch (error) {
    audit.status = 'failed';
    audit.failure_reason = 'git_fast_forward_failed';
    audit.error = String(error?.message ?? error).slice(0, 1_000);
    audit.completed_at = now().toISOString();
    writeAtomically(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
    return errorResult('git_fast_forward_failed', {
      workspace_head: workspaceHead,
      baseline_ref: baselineRef,
      baseline_commit: baselineCommit,
      baseline_refresh: baselineRefresh,
      branch,
      audit_path: auditPath
    });
  }

  let workspaceHeadAfter;
  let dirtyAfter;
  try {
    workspaceHeadAfter = gitTrimmed(resolvedRepoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
    dirtyAfter = workspaceStatus(resolvedRepoRoot);
  } catch (error) {
    audit.status = 'failed';
    audit.failure_reason = 'post_rebaseline_verification_failed';
    audit.error = String(error?.message ?? error).slice(0, 1_000);
    audit.completed_at = now().toISOString();
    writeAtomically(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
    return errorResult('post_rebaseline_verification_failed', { audit_path: auditPath });
  }

  audit.workspace_head_after = workspaceHeadAfter;
  audit.dirty_status_fingerprint_after = dirtyAfter.fingerprint;
  audit.dirty_paths_after = dirtyAfter.paths;
  audit.completed_at = now().toISOString();
  if (workspaceHeadAfter !== baselineCommit || dirtyAfter.fingerprint !== dirtyBefore.fingerprint) {
    audit.status = 'verification_failed';
    audit.failure_reason = workspaceHeadAfter !== baselineCommit
      ? 'workspace_head_did_not_reach_approved_baseline'
      : 'dirty_workspace_changed_during_rebaseline';
    writeAtomically(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
    return errorResult(audit.failure_reason, {
      workspace_head_before: workspaceHead,
      workspace_head_after: workspaceHeadAfter,
      baseline_ref: baselineRef,
      baseline_commit: baselineCommit,
      branch,
      audit_path: auditPath
    });
  }

  audit.status = 'applied';
  writeAtomically(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
  return {
    ok: true,
    schema_version: 1,
    rebaselined: true,
    reason: 'workspace_fast_forwarded_to_approved_baseline',
    workspace_head_before: workspaceHead,
    workspace_head_after: workspaceHeadAfter,
    baseline_ref: baselineRef,
    baseline_commit: baselineCommit,
    baseline_refresh: baselineRefresh,
    branch,
    controller_shell_reload_required: controllerShellSourceChanged,
    audit_path: auditPath
  };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  try {
    const args = parseArgs(process.argv);
    const result = rebaselineWorkspaceToApprovedBaseline({
      repoRoot: args.repo,
      baselineRef: args.baselineRef,
      stateDir: args.stateDir,
      runStamp: args.runStamp
    });
    const output = JSON.stringify(result);
    if (!result.ok) {
      console.error(output);
      process.exit(78);
    }
    console.log(output);
  } catch (error) {
    console.error(JSON.stringify(errorResult('invalid_arguments', { error: String(error?.message ?? error) })));
    process.exit(78);
  }
}
