#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');

const releaseJsonFiles = [
  'docs/architecture/runtime-release-contract.json',
  'docs/architecture/runtime-release-readiness-audit.json',
  'docs/architecture/phase-value-manifest.json'
];

function parseArgs(argv) {
  const args = {
    repo: defaultRepoRoot,
    stage: 'general',
    claim: '.brownie/private/phase-loop/todo-claims/current.json',
    todo: '.brownie/todo.md',
    breakdown: '.brownie/todo-breakdown.md',
    controlPlaneRoot: null,
    controllerFingerprint: null,
    snapshotSource: null,
    snapshotAudit: null,
    skipCommands: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo') {
      args.repo = argv[++index];
    } else if (arg === '--stage') {
      args.stage = argv[++index];
    } else if (arg === '--claim') {
      args.claim = argv[++index];
    } else if (arg === '--todo') {
      args.todo = argv[++index];
    } else if (arg === '--breakdown') {
      args.breakdown = argv[++index];
    } else if (arg === '--control-plane-root') {
      args.controlPlaneRoot = argv[++index];
    } else if (arg === '--controller-fingerprint') {
      args.controllerFingerprint = argv[++index];
    } else if (arg === '--snapshot-source') {
      args.snapshotSource = argv[++index];
    } else if (arg === '--snapshot-audit') {
      args.snapshotAudit = argv[++index];
    } else if (arg === '--skip-commands') {
      args.skipCommands = true;
    } else {
      throw new Error(`Unknown phase-loop preflight argument: ${arg}`);
    }
  }
  return args;
}

function requiredPathInRepository(repoRoot, requestedPath, errors) {
  const lexicalRepoRoot = path.resolve(repoRoot);
  const realRepoRoot = fs.realpathSync(repoRoot);
  const resolvedPath = path.resolve(lexicalRepoRoot, requestedPath);
  const relativePath = path.relative(lexicalRepoRoot, resolvedPath);
  if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    errors.push({
      code: 'required_file_outside_repository',
      path: requestedPath,
      message: `${requestedPath} must resolve inside the repository root.`
    });
    return null;
  }
  // Lexical containment is insufficient: readFileSync follows a symlink that
  // can point outside the repository. Resolve existing files before reading.
  if (fs.existsSync(resolvedPath)) {
    const realPath = fs.realpathSync(resolvedPath);
    const realRelativePath = path.relative(realRepoRoot, realPath);
    if (realRelativePath === '..' || realRelativePath.startsWith(`..${path.sep}`) || path.isAbsolute(realRelativePath)) {
      errors.push({
        code: 'required_file_outside_repository',
        path: requestedPath,
        message: `${requestedPath} must resolve inside the repository root.`
      });
      return null;
    }
  }
  return resolvedPath;
}

function readText(repoRoot, requestedPath, errors) {
  const resolvedPath = requiredPathInRepository(repoRoot, requestedPath, errors);
  if (!resolvedPath) {
    return '';
  }
  try {
    return fs.readFileSync(resolvedPath, 'utf8');
  } catch (error) {
    errors.push({
      code: 'required_file_unreadable',
      path: requestedPath,
      message: `${requestedPath} must be readable: ${error.message}`
    });
    return '';
  }
}

function readJson(repoRoot, relativePath, errors) {
  const text = readText(repoRoot, relativePath, errors);
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    errors.push({
      code: 'json_parse_failed',
      path: relativePath,
      message: `${relativePath} must parse as JSON: ${error.message}`
    });
    return {};
  }
}

function sha256Text(text) {
  return `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;
}

function todoSnapshotAudit({ repoRoot, todoPath, todoText, breakdownPath, breakdownText, snapshotSource, snapshotAuditPath, controllerFingerprint, errors }) {
  if (!snapshotSource) {
    return null;
  }
  const sourcePath = path.resolve(snapshotSource);
  let sourceText;
  try {
    sourceText = fs.readFileSync(sourcePath, 'utf8');
  } catch (error) {
    errors.push({
      code: 'todo_snapshot_source_unreadable',
      path: snapshotSource,
      message: `TODO snapshot source must be readable: ${error.message}`
    });
    return null;
  }
  const sourceSha256 = sha256Text(sourceText);
  const snapshotSha256 = sha256Text(todoText);
  const breakdownSha256 = breakdownText === null ? null : sha256Text(breakdownText);
  const queueCas = sha256Text(`${snapshotSha256}\n${breakdownSha256 ?? 'missing'}`);
  let generation = 0;
  let mutation = null;
  if (sourceSha256 !== snapshotSha256) {
    let audit = null;
    try {
      audit = snapshotAuditPath ? JSON.parse(fs.readFileSync(path.resolve(snapshotAuditPath), 'utf8')) : null;
    } catch {
      audit = null;
    }
    const validMutationAudit = audit
      && audit.schema_version === 1
      && audit.source_path === sourcePath
      && audit.source_sha256 === sourceSha256
      && audit.source_base_sha256 === sourceSha256
      && audit.snapshot_path === path.resolve(repoRoot, todoPath)
      && audit.snapshot_sha256 === snapshotSha256
      && audit.queue_cas === queueCas
      && (!controllerFingerprint || audit.controller_source_fingerprint === controllerFingerprint)
      && Number.isInteger(audit.generation)
      && audit.generation > 0
      && audit.mutation?.kind === 'completed_todo_removal'
      && typeof audit.mutation.previous_snapshot_sha256 === 'string';
    if (!validMutationAudit) {
      errors.push({
        code: 'todo_snapshot_mutation_audit_missing',
        path: todoPath,
        source_path: sourcePath,
        snapshot_audit_path: snapshotAuditPath ?? null,
        source_sha256: sourceSha256,
        snapshot_sha256: snapshotSha256,
        message: 'A workspace TODO snapshot differs from its source without a matching controller-owned completion mutation audit.'
      });
    } else {
      generation = audit.generation;
      mutation = audit.mutation;
    }
  }
  return {
    schema_version: 1,
    source_path: sourcePath,
    snapshot_path: path.resolve(repoRoot, todoPath),
    source_base_sha256: sourceSha256,
    source_sha256: sourceSha256,
    snapshot_sha256: snapshotSha256,
    breakdown_path: path.resolve(repoRoot, breakdownPath),
    breakdown_sha256: breakdownSha256,
    queue_cas: queueCas,
    controller_source_fingerprint: controllerFingerprint ?? null,
    generation,
    ...(mutation ? { mutation } : {})
  };
}

function nextNonWhitespace(text, index) {
  let cursor = index;
  while (/\s/u.test(text[cursor] ?? '')) {
    cursor += 1;
  }
  return cursor;
}

function readJsonString(text, start) {
  let cursor = start + 1;
  let value = '';
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '\\') {
      value += char;
      cursor += 1;
      if (cursor < text.length) {
        value += text[cursor];
        cursor += 1;
      }
      continue;
    }
    if (char === '"') {
      try {
        return { value: JSON.parse(text.slice(start, cursor + 1)), end: cursor + 1 };
      } catch {
        return { value, end: cursor + 1 };
      }
    }
    value += char;
    cursor += 1;
  }
  return null;
}

export function duplicateJsonKeys(jsonText, relativePath = '<json>') {
  const duplicates = [];
  const stack = [];
  let cursor = 0;

  while (cursor < jsonText.length) {
    const char = jsonText[cursor];
    if (char === '"') {
      const parsed = readJsonString(jsonText, cursor);
      if (!parsed) {
        return duplicates;
      }
      const frame = stack.at(-1);
      const lookahead = nextNonWhitespace(jsonText, parsed.end);
      if (frame?.kind === 'object' && frame.expectingKey && jsonText[lookahead] === ':') {
        const key = parsed.value;
        if (frame.seen.has(key)) {
          duplicates.push({
            code: 'json_duplicate_key',
            path: relativePath,
            key,
            object_path: frame.path.length > 0 ? frame.path.join('.') : '<root>',
            message: `${relativePath} must not define duplicate JSON key ${key} at ${frame.path.length > 0 ? frame.path.join('.') : '<root>'}.`
          });
        }
        frame.seen.add(key);
        frame.pendingKey = key;
        frame.expectingKey = false;
      }
      cursor = parsed.end;
      continue;
    }
    if (char === '{') {
      const parent = stack.at(-1);
      const inheritedPath = parent?.pendingKey ? [...parent.path, parent.pendingKey] : parent?.path ?? [];
      stack.push({
        kind: 'object',
        seen: new Set(),
        path: inheritedPath,
        pendingKey: '',
        expectingKey: true
      });
    } else if (char === '[') {
      const parent = stack.at(-1);
      const inheritedPath = parent?.pendingKey ? [...parent.path, parent.pendingKey] : parent?.path ?? [];
      stack.push({ kind: 'array', path: inheritedPath, pendingKey: '' });
    } else if (char === '}' || char === ']') {
      stack.pop();
      const parent = stack.at(-1);
      if (parent?.kind === 'object') {
        parent.pendingKey = '';
      }
    } else if (char === ',') {
      const frame = stack.at(-1);
      if (frame?.kind === 'object') {
        frame.pendingKey = '';
        frame.expectingKey = true;
      }
    }
    cursor += 1;
  }
  return duplicates;
}

function git(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function gitDirtyFiles(repoRoot) {
  const output = git(repoRoot, ['status', '--porcelain=v1']);
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const body = line.slice(2).trimStart();
      return body.includes(' -> ') ? body.split(' -> ').at(-1) : body;
    })
    .filter((file) => !file.startsWith('.brownie/'))
    .filter((file) => !file.startsWith('crates/brownie-runtime/.brownie/'))
    .sort();
}

function uncheckedTodoBlocks(todoText) {
  const starts = [];
  const pattern = /^(?:[-*]|\d+[.)])\s+\[\s\]\s+/gmu;
  let match;
  while ((match = pattern.exec(todoText)) !== null) {
    starts.push(match.index);
  }
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : todoText.length;
    return todoText.slice(start, end).trimEnd();
  });
}

function hasImplementableTodo(todoText) {
  return uncheckedTodoBlocks(todoText).some((block) => {
    const lower = block.toLowerCase();
    const firstLine = block.split('\n')[0] ?? '';
    if (firstLine.includes('TODO-decompose-blocked-queue-')) {
      return true;
    }
    if (lower.includes('route: implementation') || lower.includes('route: documentation') || lower.includes('route: todo-decomposition')) {
      return true;
    }
    if (/\b(?:patch|create) only\b/iu.test(block)) {
      return true;
    }
    return false;
  });
}

function runCommand(repoRoot, command, args) {
  const completed = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return {
    command: [command, ...args].join(' '),
    exit_code: completed.status ?? 1,
    stdout_tail: (completed.stdout ?? '').slice(-1200),
    stderr_tail: (completed.stderr ?? '').slice(-1200)
  };
}

function validateReleaseEvidence(repoRoot, errors) {
  for (const relativePath of releaseJsonFiles) {
    const text = readText(repoRoot, relativePath, errors);
    for (const duplicate of duplicateJsonKeys(text, relativePath)) {
      errors.push(duplicate);
    }
  }

  const contract = readJson(repoRoot, 'docs/architecture/runtime-release-contract.json', errors);
  const auditText = readText(repoRoot, 'docs/architecture/runtime-release-readiness-audit.json', errors);
  const audit = readJson(repoRoot, 'docs/architecture/runtime-release-readiness-audit.json', errors);
  const expectedHash = sha256Text(auditText);
  const actualHash = contract?.commit_trace?.readiness_audit_content_sha256;
  if (actualHash !== expectedHash) {
    errors.push({
      code: 'readiness_audit_hash_mismatch',
      path: 'docs/architecture/runtime-release-contract.json',
      expected: expectedHash,
      actual: actualHash ?? null,
      message: 'Release Contract commit_trace.readiness_audit_content_sha256 must match the current readiness audit file hash.'
    });
  }

  if (typeof audit?.audited_main_commit === 'string') {
    const normalized = audit.audited_main_commit.trim().toLowerCase();
    if (!/^[a-f0-9]{40}$/u.test(normalized)) {
      errors.push({
        code: 'readiness_audit_main_commit_not_bound',
        path: 'docs/architecture/runtime-release-readiness-audit.json',
        actual: audit.audited_main_commit,
        message: 'Readiness Audit audited_main_commit must be a concrete 40-character commit SHA, not a placeholder.'
      });
    }
  }

  try {
    const auditedCommit = typeof audit?.audited_main_commit === 'string' ? audit.audited_main_commit.trim() : '';
    if (/^[a-f0-9]{40}$/u.test(auditedCommit)) {
      const mergeBase = git(repoRoot, ['merge-base', auditedCommit, 'HEAD']);
      if (mergeBase !== auditedCommit) {
        errors.push({
          code: 'readiness_audit_main_commit_unreachable',
          path: 'docs/architecture/runtime-release-readiness-audit.json',
          actual: auditedCommit,
          message: 'Readiness Audit audited_main_commit must be a reachable ancestor of HEAD. Exact HEAD matching is intentionally not required because PR merge commits advance main after the audited evidence is generated.'
        });
      }
    }
  } catch {
    // Fixture repos may not contain the audited commit. The concrete SHA check
    // above still prevents placeholders such as "current-main"; real phase-loop
    // workspaces with full history get the ancestry check.
  }
}

function validateDirtyDelivery(repoRoot, todoText, errors) {
  const dirtyFiles = gitDirtyFiles(repoRoot);
  if (dirtyFiles.length === 0) {
    return;
  }
  if (!hasImplementableTodo(todoText)) {
    errors.push({
      code: 'dirty_delivery_required',
      dirty_files: dirtyFiles,
      message: 'The workspace has uncommitted product changes but no implementable TODO remains; phase-loop must stop for commit/PR/review/merge instead of treating owner/release blockers as completion.'
    });
  }
}

function validateRequiredCommands(repoRoot, todoPath, breakdownPath, controlPlaneRoot, errors) {
  const controlScripts = path.join(controlPlaneRoot, 'scripts');
  const commands = [
    ['node', [path.join(controlScripts, 'guard-todo-decomposition.mjs'), '--repo', repoRoot, '--todo', todoPath, '--breakdown', breakdownPath]],
    ['node', [path.join(controlScripts, 'phase-loop-todo-queue-integrity.mjs'), '--repo', repoRoot, '--todo', todoPath, '--breakdown', breakdownPath]],
    ['node', [path.join(controlScripts, 'guard-release-contract.mjs'), '--repo', repoRoot]],
    ['node', [path.join(controlScripts, 'guard-runtime-release-readiness.mjs'), '--repo', repoRoot]]
  ];
  const results = [];
  for (const [command, args] of commands) {
    const result = runCommand(repoRoot, command, args);
    results.push(result);
    if (result.exit_code !== 0) {
      errors.push({
        code: 'phase_loop_preflight_command_failed',
        command: result.command,
        stdout_tail: result.stdout_tail,
        stderr_tail: result.stderr_tail,
        message: `Phase-loop preflight command failed: ${result.command}`
      });
      break;
    }
  }
  return results;
}

export function validatePhaseLoopPreflight(options = {}) {
  const repoRoot = path.resolve(options.repo ?? defaultRepoRoot);
  const controlPlaneRoot = path.resolve(options.controlPlaneRoot ?? repoRoot);
  const errors = [];
  const warnings = [];
  const todoPath = options.todo ?? '.brownie/todo.md';
  const todoText = readText(repoRoot, todoPath, errors);
  const breakdownPath = options.breakdown ?? '.brownie/todo-breakdown.md';
  const breakdownText = options.snapshotSource
    ? readText(repoRoot, breakdownPath, errors)
    : null;
  const snapshotAudit = errors.some((error) => error.code === 'required_file_outside_repository')
    ? null
    : todoSnapshotAudit({
      repoRoot,
      todoPath,
      todoText,
      breakdownPath,
      breakdownText,
      snapshotSource: options.snapshotSource,
      snapshotAuditPath: options.snapshotAudit,
      controllerFingerprint: options.controllerFingerprint,
      errors
    });
  validateReleaseEvidence(repoRoot, errors);
  validateDirtyDelivery(repoRoot, todoText, errors);
  const commandResults = options.skipCommands ? [] : validateRequiredCommands(repoRoot, todoPath, breakdownPath, controlPlaneRoot, errors);

  return {
    schema_version: 1,
    valid: errors.length === 0,
    stage: options.stage ?? 'general',
    errors,
    warnings,
    ...(snapshotAudit ? { snapshot_audit: snapshotAudit } : {}),
    command_results: commandResults
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = validatePhaseLoopPreflight(args);
    const output = JSON.stringify(result, null, 2);
    if (result.valid) {
      console.log(output);
      process.exit(0);
    }
    console.error(output);
    process.exit(1);
  } catch (error) {
    console.error(JSON.stringify({
      schema_version: 1,
      valid: false,
      errors: [{
        code: 'phase_loop_preflight_exception',
        message: error?.message ?? String(error)
      }]
    }, null, 2));
    process.exit(1);
  }
}
