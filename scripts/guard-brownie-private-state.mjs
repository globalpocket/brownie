import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');

const forbiddenRuntimeStatePaths = [
  '.brownie/store-schema.json',
  '.brownie/store-layout.json',
  '.brownie/runs',
  '.brownie/codebase-index',
  '.brownie/headless-continuations',
  '.brownie/headless-objective-admissions',
  '.brownie/headless-journey-executions',
  '.brownie/headless-journeys',
  '.brownie/headless-run-sessions',
  '.brownie/modepack-active',
  '.brownie/modepack-candidates'
];

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function exists(repoRoot, relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

export function runBrowniePrivateStateGuard(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const forbiddenPaths = options.forbiddenPaths ?? forbiddenRuntimeStatePaths;
  const errors = [];

  for (const relativePath of forbiddenPaths) {
    if (exists(repoRoot, relativePath)) {
      errors.push(
        `${relativePath} is local Runtime state and must live under .brownie/private/ or a configured BROWNIE_STORE_ROOT outside shared .brownie/.`
      );
    }
  }

  return { errors, forbiddenPaths };
}

if (isMainModule()) {
  const result = runBrowniePrivateStateGuard();
  if (result.errors.length > 0) {
    console.error('Brownie private state guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log('Brownie private state guard passed.');
}
