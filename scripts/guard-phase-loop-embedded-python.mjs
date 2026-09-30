#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

export function extractPythonHeredocs(text) {
  const lines = text.split(/\n/);
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/\bpython3?\b/.test(line)) {
      continue;
    }

    const delimiterMatch = line.match(/<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/);
    if (!delimiterMatch) {
      continue;
    }

    const delimiter = delimiterMatch[1];
    const startLine = index + 2;
    const body = [];
    let endLine = null;

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor] === delimiter) {
        endLine = cursor + 1;
        index = cursor;
        break;
      }
      body.push(lines[cursor]);
    }

    if (endLine === null) {
      blocks.push({
        code: body.join('\n'),
        delimiter,
        endLine: lines.length,
        startLine,
        unterminated: true
      });
      break;
    }

    blocks.push({
      code: body.join('\n'),
      delimiter,
      endLine,
      startLine,
      unterminated: false
    });
  }

  return blocks;
}

function compilePython(code, filename) {
  const result = spawnSync(
    'python3',
    ['-c', 'import sys; compile(sys.stdin.read(), sys.argv[1], "exec")', filename],
    {
      encoding: 'utf8',
      input: code,
      maxBuffer: 1024 * 1024
    }
  );
  return {
    ok: result.status === 0,
    stderr: result.stderr,
    stdout: result.stdout,
    status: result.status
  };
}

function moduleImported(code, moduleName) {
  const importRegex = new RegExp(`^\\s*import\\s+[^#\\n]*\\b${moduleName}\\b`, 'm');
  const fromRegex = new RegExp(`^\\s*from\\s+${moduleName}\\s+import\\s+`, 'm');
  return importRegex.test(code) || fromRegex.test(code);
}

function moduleAliasUsed(code, moduleName) {
  const aliasRegex = new RegExp(`\\b${moduleName}\\s*\\.`, 'm');
  const annotationRegex = new RegExp(`(?:->|:)\\s*${moduleName}\\s*\\.`, 'm');
  return aliasRegex.test(code) || annotationRegex.test(code);
}

export function validateEmbeddedPythonText(text, options = {}) {
  const sourcePath = options.sourcePath ?? 'phase-loop.sh';
  const blocks = extractPythonHeredocs(text);
  const errors = [];

  for (const [index, block] of blocks.entries()) {
    const label = `${sourcePath}:python-heredoc#${index + 1}:line-${block.startLine}`;
    if (block.unterminated) {
      errors.push(`${label}: heredoc delimiter ${block.delimiter} is not terminated.`);
      continue;
    }

    const compiled = compilePython(block.code, label);
    if (!compiled.ok) {
      errors.push(`${label}: Python syntax check failed:\n${compiled.stderr || compiled.stdout}`.trimEnd());
    }

    for (const moduleName of ['re']) {
      if (moduleAliasUsed(block.code, moduleName) && !moduleImported(block.code, moduleName)) {
        errors.push(`${label}: uses '${moduleName}.' but does not import ${moduleName}.`);
      }
    }
  }

  if (blocks.length === 0) {
    errors.push(`${sourcePath}: no Python heredocs were found; guard may be pointed at the wrong file.`);
  }

  return errors;
}

export function guardPhaseLoopEmbeddedPython(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return validateEmbeddedPythonText(text, { sourcePath: filePath });
}

function main() {
  const repoRoot = process.cwd();
  const filePath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repoRoot, 'phase-loop.sh');
  const errors = guardPhaseLoopEmbeddedPython(filePath);
  if (errors.length > 0) {
    console.error('Phase-loop embedded Python guard failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log(`Phase-loop embedded Python guard passed for ${path.relative(repoRoot, filePath) || filePath}.`);
}

if (process.argv[1] === __filename) {
  main();
}
