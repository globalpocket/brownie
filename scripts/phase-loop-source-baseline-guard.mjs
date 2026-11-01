import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const controllerSourceManifestPath = 'scripts/phase-loop-controller-source-manifest.json';
// `execFileSync` defaults to a 1 MiB output buffer. The controller itself is
// intentionally a single auditable state-machine script and has crossed that
// size, so reading an approved baseline through `git show` must use an
// explicit, bounded allowance instead of failing with ENOBUFS. Keep the cap
// finite: an unexpectedly large controller source remains fail-closed.
export const controllerSourceReadMaxBufferBytes = 4 * 1024 * 1024;

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function validateControllerSourceManifest(manifest, owner) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`${owner} must be an object`);
  }
  if (manifest.schema_version !== 1) {
    throw new Error(`${owner}.schema_version must be 1`);
  }
  if (!Array.isArray(manifest.controller_source_paths) || manifest.controller_source_paths.length === 0) {
    throw new Error(`${owner}.controller_source_paths must be a non-empty array`);
  }
  const paths = manifest.controller_source_paths.map((value) => String(value));
  const uniquePaths = new Set(paths);
  if (uniquePaths.size !== paths.length) {
    throw new Error(`${owner}.controller_source_paths must not contain duplicates`);
  }
  if (paths.some((value) => !value || value.startsWith('/') || value.includes('..'))) {
    throw new Error(`${owner}.controller_source_paths must contain repository-relative paths`);
  }
  if (paths.some((value, index) => index > 0 && paths[index - 1].localeCompare(value) >= 0)) {
    throw new Error(`${owner}.controller_source_paths must be sorted`);
  }
  return paths;
}

export function readControllerSourceManifest(repoRoot = repositoryRoot) {
  return validateControllerSourceManifest(
    readJsonFile(path.join(repoRoot, controllerSourceManifestPath)),
    controllerSourceManifestPath
  );
}

export const approvedControllerSourcePaths = Object.freeze(readControllerSourceManifest());

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readBaselineFile(repoRoot, baselineRef, relativePath) {
  return execFileSync('git', ['-C', repoRoot, 'show', '--format=', `${baselineRef}:${relativePath}`], {
    encoding: 'utf8',
    maxBuffer: controllerSourceReadMaxBufferBytes,
    stdio: ['ignore', 'pipe', 'pipe']
  });
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
    execFileSync('git', ['-C', repoRoot, 'fetch', '--no-tags', '--force', parts.remote, refspec], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { required: true, refreshed: true, remote: parts.remote, branch: parts.branch };
  } catch (error) {
    return {
      required: true,
      refreshed: false,
      remote: parts.remote,
      branch: parts.branch,
      error: error.message
    };
  }
}

export function inspectPhaseLoopSourceBaseline({
  repoRoot = repositoryRoot,
  baselineRef = 'origin/main',
  refreshBaseline = true
} = {}) {
  const errors = [];
  let currentHead = '';
  let baselineCommit = '';
  let baselineRefresh = { required: false, refreshed: false };
  try {
    currentHead = git(repoRoot, ['rev-parse', 'HEAD']);
  } catch (error) {
    errors.push(`controller source HEAD could not be resolved: ${error.message}`);
  }
  if (refreshBaseline) {
    baselineRefresh = refreshRemoteTrackingBaseline(repoRoot, baselineRef);
    if (baselineRefresh.required && !baselineRefresh.refreshed) {
      errors.push(`approved controller baseline ${baselineRef} could not be refreshed: ${baselineRefresh.error}`);
    }
  }
  try {
    baselineCommit = git(repoRoot, ['rev-parse', '--verify', `${baselineRef}^{commit}`]);
  } catch (error) {
    errors.push(`approved controller baseline ${baselineRef} could not be resolved: ${error.message}`);
  }

  let currentManifestPaths = [];
  let baselineManifestPaths = [];
  try {
    currentManifestPaths = readControllerSourceManifest(repoRoot);
  } catch (error) {
    errors.push(`controller source manifest could not be read: ${error.message}`);
  }
  try {
    baselineManifestPaths = validateControllerSourceManifest(
      JSON.parse(readBaselineFile(repoRoot, baselineRef, controllerSourceManifestPath)),
      `${baselineRef}:${controllerSourceManifestPath}`
    );
  } catch (error) {
    errors.push(`approved controller source manifest could not be read from ${baselineRef}: ${error.message}`);
  }

  const sourcePaths = [...new Set([...currentManifestPaths, ...baselineManifestPaths])].sort();
  const files = [];
  for (const relativePath of [controllerSourceManifestPath, ...sourcePaths]) {
    const currentPath = path.join(repoRoot, relativePath);
    let currentText;
    try {
      currentText = fs.readFileSync(currentPath);
    } catch (error) {
      errors.push(`${relativePath} current controller source could not be read: ${error.message}`);
      continue;
    }
    let baselineText;
    try {
      baselineText = readBaselineFile(repoRoot, baselineRef, relativePath);
    } catch (error) {
      errors.push(`${relativePath} approved baseline source could not be read from ${baselineRef}: ${error.message}`);
      continue;
    }
    const currentSha256 = sha256(currentText);
    const baselineSha256 = sha256(baselineText);
    const matches = currentSha256 === baselineSha256;
    files.push({ relative_path: relativePath, current_sha256: currentSha256, baseline_sha256: baselineSha256, matches });
    if (!matches) {
      errors.push(`${relativePath} diverges from approved controller baseline ${baselineRef}`);
    }
  }

  const sourceFingerprint = sha256(JSON.stringify(files.map((file) => [file.relative_path, file.current_sha256])));
  return {
    baseline_ref: baselineRef,
    baseline_commit: baselineCommit,
    baseline_refresh: baselineRefresh,
    current_head: currentHead,
    source_fingerprint: `sha256:${sourceFingerprint}`,
    files,
    errors
  };
}

export function guardPhaseLoopSourceBaseline(options = {}) {
  const result = inspectPhaseLoopSourceBaseline(options);
  return { ...result, ok: result.errors.length === 0 };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const repoRoot = process.argv.includes('--repo') ? process.argv[process.argv.indexOf('--repo') + 1] : repositoryRoot;
  const baselineRef = process.argv.includes('--baseline-ref')
    ? process.argv[process.argv.indexOf('--baseline-ref') + 1]
    : 'origin/main';
  const result = guardPhaseLoopSourceBaseline({ repoRoot, baselineRef });
  if (!result.ok) {
    console.error('Phase-loop source baseline guard failed:');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(78);
  }
  console.log(JSON.stringify({ baseline_ref: result.baseline_ref, baseline_commit: result.baseline_commit, baseline_refresh: result.baseline_refresh, current_head: result.current_head, source_fingerprint: result.source_fingerprint }));
}
