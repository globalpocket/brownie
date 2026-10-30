#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultWorkspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(workspaceRoot, args) {
  return execFileSync('git', ['-C', workspaceRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function remoteTrackingRefParts(baselineRef) {
  const match = String(baselineRef).match(/^(?:refs\/remotes\/)?([^/]+)\/(.+)$/u);
  if (!match || match[1] === 'HEAD' || /^[0-9a-f]{40}$/u.test(String(baselineRef))) return null;
  return { remote: match[1], branch: match[2] };
}

function refreshRemoteTrackingBaseline(workspaceRoot, baselineRef) {
  const parts = remoteTrackingRefParts(baselineRef);
  if (!parts) return { required: false, refreshed: false };
  const refspec = `+refs/heads/${parts.branch}:refs/remotes/${parts.remote}/${parts.branch}`;
  try {
    execFileSync('git', ['-C', workspaceRoot, 'fetch', '--no-tags', '--force', parts.remote, refspec], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { required: true, refreshed: true, remote: parts.remote, branch: parts.branch };
  } catch (error) {
    return { required: true, refreshed: false, remote: parts.remote, branch: parts.branch, error: error.message };
  }
}

function commitTreeId(workspaceRoot, commit) {
  return git(workspaceRoot, ['rev-parse', '--verify', `${commit}^{tree}`]);
}

export function inspectWorkspaceBaseline({
  workspaceRoot = defaultWorkspaceRoot,
  baselineRef = 'origin/main',
  refreshBaseline = true
} = {}) {
  const errors = [];
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  let workspaceHead = '';
  let baselineCommit = '';
  let workspaceTree = '';
  let baselineTree = '';
  let baselineRefresh = { required: false, refreshed: false };

  try {
    workspaceHead = git(resolvedWorkspaceRoot, ['rev-parse', 'HEAD']);
  } catch (error) {
    errors.push(`workspace HEAD could not be resolved: ${error.message}`);
  }
  if (refreshBaseline) {
    baselineRefresh = refreshRemoteTrackingBaseline(resolvedWorkspaceRoot, baselineRef);
    if (baselineRefresh.required && !baselineRefresh.refreshed) {
      errors.push(`workspace baseline ${baselineRef} could not be refreshed: ${baselineRefresh.error}`);
    }
  }
  try {
    baselineCommit = git(resolvedWorkspaceRoot, ['rev-parse', '--verify', `${baselineRef}^{commit}`]);
  } catch (error) {
    errors.push(`workspace baseline ${baselineRef} could not be resolved: ${error.message}`);
  }

  let baselineIsAncestor = false;
  let baselineTreeEquivalent = false;
  if (workspaceHead && baselineCommit) {
    try {
      execFileSync('git', ['-C', resolvedWorkspaceRoot, 'merge-base', '--is-ancestor', baselineCommit, workspaceHead], {
        stdio: 'ignore'
      });
      baselineIsAncestor = true;
    } catch {
      try {
        workspaceTree = commitTreeId(resolvedWorkspaceRoot, workspaceHead);
        baselineTree = commitTreeId(resolvedWorkspaceRoot, baselineCommit);
        baselineTreeEquivalent = workspaceTree === baselineTree;
      } catch (error) {
        errors.push(`workspace history equivalence could not be resolved: ${error.message}`);
      }
      if (!baselineTreeEquivalent) {
        errors.push(`workspace HEAD ${workspaceHead} neither contains nor is tree-equivalent to approved baseline ${baselineRef} (${baselineCommit}); snapshot and explicitly rebaseline the workspace before claim`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    schema_version: 1,
    workspace_root: resolvedWorkspaceRoot,
    workspace_head: workspaceHead,
    baseline_ref: baselineRef,
    baseline_commit: baselineCommit,
    baseline_refresh: baselineRefresh,
    baseline_is_ancestor: baselineIsAncestor,
    baseline_tree_equivalent: baselineTreeEquivalent,
    workspace_tree: workspaceTree,
    baseline_tree: baselineTree,
    errors
  };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const argv = process.argv.slice(2);
  const workspaceIndex = argv.indexOf('--workspace-root');
  const baselineIndex = argv.indexOf('--baseline-ref');
  const result = inspectWorkspaceBaseline({
    workspaceRoot: workspaceIndex >= 0 ? argv[workspaceIndex + 1] : defaultWorkspaceRoot,
    baselineRef: baselineIndex >= 0 ? argv[baselineIndex + 1] : 'origin/main'
  });
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(78);
  }
  console.log(JSON.stringify(result));
}
