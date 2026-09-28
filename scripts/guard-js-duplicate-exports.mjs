import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');

export function findDuplicateExportDeclarations(sourceText) {
  const counts = new Map();
  const pattern = /^\s*export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)\b/gm;
  let match;
  while ((match = pattern.exec(sourceText)) !== null) {
    const name = match[1];
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name, count }));
}

export function validateNoDuplicateExportDeclarations(filePath, options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const absolutePath = path.resolve(repoRoot, filePath);
  const sourceText = fs.readFileSync(absolutePath, 'utf8');
  const duplicates = findDuplicateExportDeclarations(sourceText);
  return {
    valid: duplicates.length === 0,
    filePath,
    duplicates
  };
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/guard-js-duplicate-exports.mjs <file>');
    process.exit(2);
  }
  const result = validateNoDuplicateExportDeclarations(filePath);
  if (!result.valid) {
    for (const duplicate of result.duplicates) {
      console.error(`${filePath}: duplicate exported declaration ${duplicate.name} appears ${duplicate.count} times.`);
    }
    process.exit(1);
  }
  console.log(`No duplicate exported declarations found in ${filePath}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
