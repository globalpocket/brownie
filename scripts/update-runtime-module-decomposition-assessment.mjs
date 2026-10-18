import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectRuntimeModuleMetrics } from './guard-runtime-module-decomposition.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assessmentRelativePath = 'docs/architecture/runtime-module-decomposition-assessment.json';

export function buildRuntimeModuleDecompositionAssessment(repoRoot = repositoryRoot) {
  const assessmentPath = path.join(repoRoot, assessmentRelativePath);
  const assessment = JSON.parse(fs.readFileSync(assessmentPath, 'utf8'));
  const metrics = collectRuntimeModuleMetrics(repoRoot, assessment.source_paths);
  return {
    ...assessment,
    metrics: {
      ...assessment.metrics,
      files: {
        ...(assessment.metrics?.files ?? {}),
        ...metrics
      }
    }
  };
}

export function syncRuntimeModuleDecompositionAssessment(repoRoot = repositoryRoot, { check = false } = {}) {
  const assessmentPath = path.join(repoRoot, assessmentRelativePath);
  const currentText = fs.readFileSync(assessmentPath, 'utf8');
  const expectedText = `${JSON.stringify(buildRuntimeModuleDecompositionAssessment(repoRoot), null, 2)}\n`;
  if (currentText === expectedText) {
    return { changed: false, assessmentPath };
  }
  if (check) {
    throw new Error(`${assessmentRelativePath} is stale; run pnpm --workspace-root generate:runtime-module-decomposition-assessment`);
  }
  fs.writeFileSync(assessmentPath, expectedText, 'utf8');
  return { changed: true, assessmentPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const result = syncRuntimeModuleDecompositionAssessment(repositoryRoot, {
      check: process.argv.slice(2).includes('--check')
    });
    console.log(result.changed ? `updated ${assessmentRelativePath}` : `current ${assessmentRelativePath}`);
  } catch (error) {
    console.error(error?.message ?? error);
    process.exit(1);
  }
}
