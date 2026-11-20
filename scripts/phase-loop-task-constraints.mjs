#!/usr/bin/env node
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { boundedScopeEntries } from './phase-loop-bounded-scope.mjs';

function exactPath(value) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 2048 ||
      /[\u0000-\u001f\u007f-\u009f\\:*?\[\]]/u.test(value) ||
      value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('task constraints require an exact normalized workspace-relative path');
  }
  return value;
}

/** Project planning stays here; the Runtime receives only generic restrictions. */
export function compileTaskConstraints(prompt, { queuePath = '.brownie/todo.md', state = 'implementation' } = {}) {
  if (typeof prompt !== 'string' || Buffer.byteLength(prompt) > 65536) {
    throw new Error('constraint source prompt exceeds its bound');
  }
  // A controller may keep its queue outside the execution workspace. Such a
  // queue has no Runtime-relative path and cannot be a Runtime write target.
  if (queuePath !== null) exactPath(queuePath);
  const sections = prompt.split(/^## Selected TODO\s*$/mu);
  if (sections.length !== 2) throw new Error('exactly one Selected TODO section is required');
  const selected = sections[1].split(/^## /mu, 1)[0].trim();
  const firstLine = selected.split('\n')[0];
  if (!/^[-*] \[ \] \S+:/u.test(firstLine)) throw new Error('an unchecked named selected TODO is required');
  const queueOnly = ['decompose_todo', 'todo_queue_repair'].includes(state);
  if (queueOnly && queuePath === null) throw new Error('external controller queue requires controller-owned replan; no Runtime workspace target');
  if (!queueOnly && !['implementation', 'implement', 'review_rework', 'verify_or_repair', 'release_engineering', 'documentation'].includes(state)) {
    throw new Error('unsupported planning state; re-estimate before Runtime admission');
  }
  const entries = queueOnly ? [{ path: queuePath, operation: 'patch' }] : boundedScopeEntries(firstLine);
  if (!entries.length || entries.length > 128) throw new Error('bounded Patch/Create scope required; split or re-estimate the TODO');
  const operations = new Set(entries.map((entry) => entry.operation));
  // A flat operation list must never widen a mixed per-path contract.
  if (operations.size !== 1) throw new Error('mixed Patch/Create scopes require separate TODOs');
  const paths = [...new Set(entries.map((entry) => exactPath(entry.path)))];
  const operation = entries[0].operation;
  const denied = [...new Set(selected.split('\n').filter((line) => /^\s*Forbidden changes:/u.test(line))
    .flatMap((line) => [...line.matchAll(/`([^`]+)`/gu)].map((match) => exactPath(match[1]))))];
  if (!queueOnly && queuePath !== null && !paths.includes(queuePath)) denied.push(queuePath);
  if (paths.some((path) => denied.includes(path))) throw new Error('selected scope conflicts with Forbidden changes');
  // Recovery instructions are controller policy, not text the Runtime parses.
  // An explicitly admitted exact-context reread takes precedence over a
  // previous write-next hint, but never permits a different target.
  const repairContext = sections[0];
  const allowExactReread = /^- (?:leaf_target_read_missing_repair_policy|stale_read_preview_policy|leaf_retry_read_first_policy|leaf_exact_context_reread_policy):/mu.test(repairContext);
  const embeddedPreview = /^- read_budget_repair_policy:/mu.test(repairContext)
    && /^- previous_workspace_read_preview_/mu.test(repairContext);
  const forceWrite = !queueOnly && !allowExactReread && (embeddedPreview
    || /^- (?:leaf_required_next_tool_policy|leaf_oversized_repair_next_tool_policy|leaf_retry_required_next_tool):/mu.test(repairContext));
  const deniedReads = [...new Set([...selected.matchAll(/Do not read\b([\s\S]*?)(?=\.\s|$)/giu)]
    .flatMap(match => [...match[1].matchAll(/`([^`]+)`/gu)].map(value => exactPath(value[1]))))];
  return {
    read_paths: operation === 'create' || forceWrite ? [] : paths,
    denied_read_paths: deniedReads,
    write_paths: paths,
    denied_write_paths: [...new Set(denied)],
    write_operations: [operation === 'create' ? 'create_file' : 'patch_file'],
    max_workspace_reads: operation === 'create' || forceWrite ? 0 : allowExactReread && !queueOnly ? 1 : 2,
    requires_workspace_write_proposal: true,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [promptPath, metadataPath, outputPath, ...extra] = process.argv.slice(2);
  if (!promptPath || !metadataPath || !outputPath || extra.length) {
    throw new Error('usage: phase-loop-task-constraints.mjs PROMPT METADATA OUTPUT');
  }
  function readBounded(input) {
    const fd = fs.openSync(input, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      if (!fs.fstatSync(fd).isFile()) throw new Error('constraint input must be a regular file');
      const buffer = Buffer.alloc(65537);
      let bytes = 0;
      while (bytes < buffer.length) {
        const count = fs.readSync(fd, buffer, bytes, buffer.length - bytes, null);
        if (!count) break;
        bytes += count;
      }
      if (bytes > 65536) throw new Error('constraint input exceeds its bound');
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes));
    } finally { fs.closeSync(fd); }
  }
  const prompt = readBounded(promptPath);
  const metadataText = readBounded(metadataPath);
  const metadata = JSON.parse(metadataText);
  if (metadata.prompt_sha256 !== createHash('sha256').update(prompt).digest('hex')) {
    throw new Error('constraint prompt does not match its controller metadata');
  }
  if (typeof metadata.selected_todo_text !== 'string' ||
      metadata.selected_todo_sha256 !== createHash('sha256').update(metadata.selected_todo_text).digest('hex')) {
    throw new Error('full selected TODO does not match its controller metadata');
  }
  // Prompt truncation is a model-view concern, never a source of scope authority.
  const sections = prompt.split(/^## Selected TODO\s*$/mu);
  if (sections.length !== 2) throw new Error('exactly one Selected TODO section is required');
  const fullSource = `${sections[0]}\n## Selected TODO\n\n${metadata.selected_todo_text}\n`;
  const constraints = compileTaskConstraints(fullSource, { state: metadata.bdk_state, queuePath: metadata.queue_relative_path });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(constraints, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, outputPath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  const validatorPath = `${outputPath}.validator.json`;
  const validatorTemporary = `${validatorPath}.${process.pid}.tmp`;
  const policyMetadata = {
    selected_todo_text: metadata.selected_todo_text,
    selected_todo_sha256: metadata.selected_todo_sha256,
    bdk_state: metadata.bdk_state,
    queue_relative_path: metadata.queue_relative_path
  };
  const validator = {
    schema_version: 1,
    program: process.execPath,
    args: [fileURLToPath(new URL('./repair-todo-decomposition.mjs', import.meta.url)), '--validate-runtime-proposal', '1'],
    // Keep the validated scope in the claim, independent of prompt retention.
    context: { metadata: policyMetadata, metadata_sha256: `sha256:${createHash('sha256').update(JSON.stringify(policyMetadata)).digest('hex')}` }
  };
  if (Buffer.byteLength(JSON.stringify(validator)) > 65536) throw new Error('validator policy exceeds its bound; split the TODO');
  try {
    fs.writeFileSync(validatorTemporary, `${JSON.stringify(validator, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(validatorTemporary, validatorPath);
  } finally {
    if (fs.existsSync(validatorTemporary)) fs.unlinkSync(validatorTemporary);
  }
}
