import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');

export function findDuplicateExportDeclarations(sourceText) {
  const sourceCode = maskJavaScriptNonCode(sourceText);
  const counts = new Map();
  const pattern = /^\s*export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)\b/gm;
  let match;
  while ((match = pattern.exec(sourceCode)) !== null) {
    const name = match[1];
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name, count }));
}

function maskJavaScriptNonCode(sourceText) {
  let masked = '';
  let index = 0;
  while (index < sourceText.length) {
    const character = sourceText[index];
    if (character === '\'' || character === '"') {
      const nextIndex = readQuotedJavaScriptString(sourceText, index).nextIndex;
      masked += sourceText.slice(index, nextIndex).replace(/[^\r\n]/gu, ' ');
      index = nextIndex;
      continue;
    }
    if (character === '`') {
      const nextIndex = skipTemplateLiteral(sourceText, index);
      masked += sourceText.slice(index, nextIndex).replace(/[^\r\n]/gu, ' ');
      index = nextIndex;
      continue;
    }
    if (character === '/' && sourceText[index + 1] === '/') {
      const lineEnd = sourceText.indexOf('\n', index + 2);
      const nextIndex = lineEnd === -1 ? sourceText.length : lineEnd;
      masked += sourceText.slice(index, nextIndex).replace(/[^\r\n]/gu, ' ');
      index = nextIndex;
      continue;
    }
    if (character === '/' && sourceText[index + 1] === '*') {
      const commentEnd = sourceText.indexOf('*/', index + 2);
      const nextIndex = commentEnd === -1 ? sourceText.length : commentEnd + 2;
      masked += sourceText.slice(index, nextIndex).replace(/[^\r\n]/gu, ' ');
      index = nextIndex;
      continue;
    }
    masked += character;
    index += 1;
  }
  return masked;
}

function isIdentifierCharacter(character) {
  return character !== undefined && /[A-Za-z0-9_$]/u.test(character);
}

function readQuotedJavaScriptString(sourceText, startIndex) {
  const quote = sourceText[startIndex];
  let value = '';
  let index = startIndex + 1;
  while (index < sourceText.length) {
    const character = sourceText[index];
    if (character === '\\') {
      const escaped = sourceText[index + 1];
      if (escaped !== undefined) {
        value += escaped;
        index += 2;
        continue;
      }
    }
    if (character === quote) {
      return { value, nextIndex: index + 1 };
    }
    value += character;
    index += 1;
  }
  return { value, nextIndex: sourceText.length };
}

function skipTemplateLiteral(sourceText, startIndex) {
  let index = startIndex + 1;
  while (index < sourceText.length) {
    if (sourceText[index] === '\\') {
      index += 2;
      continue;
    }
    if (sourceText[index] === '`') {
      return index + 1;
    }
    index += 1;
  }
  return sourceText.length;
}

function staticNodeTestDeclarationAt(sourceText, startIndex) {
  if (sourceText.slice(startIndex, startIndex + 4) !== 'test') {
    return null;
  }
  const previous = sourceText[startIndex - 1];
  const following = sourceText[startIndex + 4];
  if (isIdentifierCharacter(previous) || previous === '.' || isIdentifierCharacter(following)) {
    return null;
  }
  let index = startIndex + 4;
  while (/\s/u.test(sourceText[index] ?? '')) {
    index += 1;
  }
  if (sourceText[index] === '.') {
    const modifier = /^(only|skip|todo)\b/u.exec(sourceText.slice(index + 1));
    if (!modifier) {
      return null;
    }
    index += modifier[0].length + 1;
    while (/\s/u.test(sourceText[index] ?? '')) {
      index += 1;
    }
  }
  if (sourceText[index] !== '(') {
    return null;
  }
  index += 1;
  while (/\s/u.test(sourceText[index] ?? '')) {
    index += 1;
  }
  if (sourceText[index] !== '\'' && sourceText[index] !== '"') {
    return null;
  }
  return readQuotedJavaScriptString(sourceText, index);
}

export function findDuplicateNodeTestDeclarations(sourceText) {
  const importsNodeTest = /\bfrom\s*['"]node:test['"]|\brequire\s*\(\s*['"]node:test['"]\s*\)/u.test(sourceText);
  if (!importsNodeTest) {
    return [];
  }
  const counts = new Map();
  let index = 0;
  while (index < sourceText.length) {
    const character = sourceText[index];
    if (character === '\'' || character === '"') {
      index = readQuotedJavaScriptString(sourceText, index).nextIndex;
      continue;
    }
    if (character === '`') {
      index = skipTemplateLiteral(sourceText, index);
      continue;
    }
    if (character === '/' && sourceText[index + 1] === '/') {
      const lineEnd = sourceText.indexOf('\n', index + 2);
      index = lineEnd === -1 ? sourceText.length : lineEnd + 1;
      continue;
    }
    if (character === '/' && sourceText[index + 1] === '*') {
      const commentEnd = sourceText.indexOf('*/', index + 2);
      index = commentEnd === -1 ? sourceText.length : commentEnd + 2;
      continue;
    }
    if (character === 't') {
      const declaration = staticNodeTestDeclarationAt(sourceText, index);
      if (declaration) {
        counts.set(declaration.value, (counts.get(declaration.value) ?? 0) + 1);
        index = declaration.nextIndex;
        continue;
      }
    }
    index += 1;
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
  const duplicateTests = findDuplicateNodeTestDeclarations(sourceText);
  return {
    valid: duplicates.length === 0 && duplicateTests.length === 0,
    filePath,
    duplicates,
    duplicateTests
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
    for (const duplicateTest of result.duplicateTests) {
      console.error(`${filePath}: duplicate node:test declaration ${JSON.stringify(duplicateTest.name)} appears ${duplicateTest.count} times.`);
    }
    process.exit(1);
  }
  console.log(`No duplicate exported declarations or node:test declarations found in ${filePath}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
