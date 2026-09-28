#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, printParseErrorCode } from 'jsonc-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');

function lineColumnAtOffset(text, offset) {
  const prefix = text.slice(0, Math.max(0, offset));
  const lines = prefix.split(/\r\n|\r|\n/u);
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1
  };
}

export function validateJsonParse({
  repoRoot = defaultRepoRoot,
  filePath
} = {}) {
  if (!filePath || typeof filePath !== 'string') {
    return [{
      code: 'MissingFilePath',
      message: 'filePath is required'
    }];
  }
  const absolutePath = path.resolve(repoRoot, filePath);
  const text = fs.readFileSync(absolutePath, 'utf8');
  const errors = [];
  parse(text, errors, {
    allowTrailingComma: false,
    disallowComments: filePath.endsWith('.json')
  });
  return errors.map((error) => {
    const location = lineColumnAtOffset(text, error.offset);
    return {
      code: printParseErrorCode(error.error),
      offset: error.offset,
      length: error.length,
      line: location.line,
      column: location.column,
      message: `${printParseErrorCode(error.error)} at line ${location.line}, column ${location.column}`
    };
  });
}

if (process.argv[1] === __filename) {
  const target = process.argv[2];
  const errors = validateJsonParse({ filePath: target });
  if (errors.length > 0) {
    console.error(`JSON parse guard failed for ${target}:`);
    for (const error of errors) {
      console.error(`- ${error.message}`);
    }
    process.exit(1);
  }
  console.log(`JSON parse guard passed for ${target}.`);
}
