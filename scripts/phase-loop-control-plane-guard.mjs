#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const manifestPath = 'scripts/phase-loop-controller-source-manifest.json';

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function gitShow(repoRoot, baselineRef, relativePath) {
  return execFileSync('git', ['-C', repoRoot, 'show', '--format=', `${baselineRef}:${relativePath}`], {
    encoding: null,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function readManifest(repoRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, manifestPath), 'utf8'));
  const paths = manifest.control_plane_paths;
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error(`${manifestPath}.control_plane_paths must be a non-empty array`);
  }
  const unique = new Set(paths);
  if (unique.size !== paths.length) {
    throw new Error(`${manifestPath}.control_plane_paths must not contain duplicates`);
  }
  if (paths.some((value) => typeof value !== 'string' || !value || value.startsWith('/') || value.includes('..'))) {
    throw new Error(`${manifestPath}.control_plane_paths must contain repository-relative paths`);
  }
  if (paths.some((value, index) => index > 0 && paths[index - 1].localeCompare(value) >= 0)) {
    throw new Error(`${manifestPath}.control_plane_paths must be sorted`);
  }
  const sourcePaths = new Set(manifest.controller_source_paths ?? []);
  const unmanifested = paths.filter((value) => !sourcePaths.has(value));
  if (unmanifested.length > 0) {
    throw new Error(`${manifestPath}.control_plane_paths must be covered by controller_source_paths: ${unmanifested.join(', ')}`);
  }
  return paths;
}

export function inspectControlPlaneSource({
  repoRoot = defaultRepoRoot,
  baselineRef = 'origin/main'
} = {}) {
  const errors = [];
  const root = path.resolve(repoRoot);
  let paths = [];
  let baselineCommit = null;
  try {
    paths = readManifest(root);
  } catch (error) {
    errors.push(String(error.message ?? error));
  }
  try {
    baselineCommit = git(root, ['rev-parse', '--verify', `${baselineRef}^{commit}`]);
  } catch (error) {
    errors.push(`approved controller baseline ${baselineRef} could not be resolved: ${error.message}`);
  }
  const files = paths.map((relativePath) => {
    const currentPath = path.join(root, relativePath);
    let current = null;
    let baseline = null;
    try { current = fs.readFileSync(currentPath); } catch (error) {
      errors.push(`${relativePath} control-plane source is unreadable: ${error.message}`);
    }
    try { baseline = gitShow(root, baselineRef, relativePath); } catch (error) {
      errors.push(`${relativePath} approved baseline source is unavailable: ${error.message}`);
    }
    const currentSha256 = current ? sha256(current) : null;
    const baselineSha256 = baseline ? sha256(baseline) : null;
    if (currentSha256 !== baselineSha256) {
      errors.push(`${relativePath} control-plane source diverges from approved controller baseline ${baselineRef}`);
    }
    return { relative_path: relativePath, current_sha256: currentSha256, baseline_sha256: baselineSha256 };
  });
  const sourceFingerprint = sha256(JSON.stringify(files.map((file) => [file.relative_path, file.current_sha256])));
  return {
    ok: errors.length === 0,
    schema_version: 1,
    baseline_ref: baselineRef,
    baseline_commit: baselineCommit,
    control_plane_paths: paths,
    source_fingerprint: sourceFingerprint,
    files,
    errors
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const argv = process.argv.slice(2);
  const repoIndex = argv.indexOf('--repo');
  const baselineIndex = argv.indexOf('--baseline-ref');
  const repoRoot = repoIndex >= 0 ? argv[repoIndex + 1] : defaultRepoRoot;
  const baselineRef = baselineIndex >= 0 ? argv[baselineIndex + 1] : 'origin/main';
  const result = inspectControlPlaneSource({ repoRoot, baselineRef });
  const output = JSON.stringify(result, null, 2);
  if (result.ok) {
    console.log(output);
    process.exit(0);
  }
  console.error(output);
  process.exit(78);
}
