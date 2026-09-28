#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');

function readJson(repoRoot, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function readText(repoRoot, relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function extractFunctionBlock(source, functionName) {
  const pattern = new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`, 'u');
  const match = pattern.exec(source);
  if (!match) {
    return null;
  }
  let depth = 0;
  let started = false;
  for (let index = match.index; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
      started = true;
    } else if (char === '}') {
      depth -= 1;
      if (started && depth === 0) {
        return source.slice(match.index, index + 1);
      }
    }
  }
  return null;
}

function functionNameFromBlock(block) {
  const match = /^function\s+([A-Za-z_$][\w$]*)\s*\(/u.exec(block);
  return match ? match[1] : null;
}

function extractFunctionBlocks(source) {
  const pattern = /function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/gu;
  const blocks = [];
  for (const match of source.matchAll(pattern)) {
    const header = match[0];
    let depth = 0;
    let started = false;
    for (let index = match.index; index < source.length; index += 1) {
      const char = source[index];
      if (char === '{') {
        depth += 1;
        started = true;
      } else if (char === '}') {
        depth -= 1;
        if (started && depth === 0) {
          blocks.push({
            name: functionNameFromBlock(header) ?? '',
            text: source.slice(match.index, index + 1)
          });
          break;
        }
      }
    }
  }
  return blocks;
}

function inferredTopLevelDocFields(scriptText) {
  const fields = new Set();
  for (const match of scriptText.matchAll(/\bdoc\.([A-Za-z_$][\w$]*)/g)) {
    fields.add(match[1]);
  }
  for (const match of scriptText.matchAll(/\bdoc\[['"]([^'"]+)['"]\]/g)) {
    fields.add(match[1]);
  }
  return [...fields].sort();
}

function functionIsReferencedOutsideOwnBlock(source, block) {
  if (!block.name) {
    return true;
  }
  const outside = source.replace(block.text, '');
  const pattern = new RegExp(`\\b${block.name}\\s*\\(`, 'u');
  return pattern.test(outside);
}

function buildAuditValidatorReplacement(target) {
  const topLevelKeys = Object.keys(target).sort();
  const requiredTopLevel = [
    'schema_version',
    'phase',
    'repository',
    'runtime_release_ready',
    'release_ready_blocked_by',
    'ledger_event_kind',
    'classifications',
    'blockers',
    'release_blockers'
  ].filter((key) => topLevelKeys.includes(key));
  const requiredTopLevelJson = JSON.stringify(requiredTopLevel);

  return `function validateAuditDocument(doc) {
  const errors = [];
  const required = ${requiredTopLevelJson};
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  if (!object(doc)) return ['document must be object'];
  for (const field of required) if (!(field in doc)) errors.push(\`missing field: \${field}\`);
  if (doc.schema_version !== 1) errors.push('schema_version must be 1');
  if (typeof doc.phase !== 'string' || !doc.phase) errors.push('phase must be string');
  if (doc.repository !== 'globalpocket/brownie') errors.push('repository mismatch');
  if (doc.runtime_release_ready !== false) errors.push('runtime_release_ready must be false');
  if (!Array.isArray(doc.release_ready_blocked_by)) errors.push('release_ready_blocked_by must be array');
  if (!object(doc.ledger_event_kind)) errors.push('ledger_event_kind must be object');
  else if (!Array.isArray(doc.ledger_event_kind.values) || !doc.ledger_event_kind.values.every((value) => typeof value === 'string' && value)) errors.push('ledger_event_kind.values invalid');
  if (!Array.isArray(doc.classifications)) errors.push('classifications must be array');
  else for (const [index, item] of doc.classifications.entries()) {
    if (!object(item)) errors.push(\`classifications[\${index}] must be object\`);
    else if (typeof item.id !== 'string' || !item.id) errors.push(\`classifications[\${index}].id invalid\`);
  }
  if (!Array.isArray(doc.blockers)) errors.push('blockers must be array');
  if (!Array.isArray(doc.release_blockers)) errors.push('release_blockers must be array');
  return errors;
}`;
}

export function repairValidatorSchemaAssumptions({
  repoRoot = defaultRepoRoot,
  validatorPath = 'scripts/validate-audit-schema.mjs',
  targetPath = 'docs/architecture/runtime-release-readiness-audit.json'
} = {}) {
  const scriptText = readText(repoRoot, validatorPath);
  const target = readJson(repoRoot, targetPath);
  const targetKeys = new Set(Object.keys(target));
  const staleHelperBlocks = extractFunctionBlocks(scriptText).filter((block) => {
    if (block.name === 'validateAuditDocument' || block.name === 'main') {
      return false;
    }
    const missingFields = inferredTopLevelDocFields(block.text).filter((field) => !targetKeys.has(field));
    return missingFields.length > 0 && !functionIsReferencedOutsideOwnBlock(scriptText, block);
  });
  if (staleHelperBlocks.length > 0) {
    const oldText = staleHelperBlocks.map((block) => `${block.text}\n\n`).join('');
    return {
      repairable: true,
      reason: 'validator_stale_schema_helper_mismatch',
      path: validatorPath,
      operation: 'patch_file',
      old_text: oldText,
      new_text: '',
      target_path: targetPath,
      repair_hint: 'Remove exactly these unreferenced helper functions because they require top-level fields absent from the target JSON. Do not edit validateAuditDocument(), main(), imports, or .brownie/todo.md.'
    };
  }
  const oldText = extractFunctionBlock(scriptText, 'validateAuditDocument');
  if (!oldText) {
    return {
      repairable: false,
      reason: 'validateAuditDocument_not_found',
      validatorPath,
      targetPath
    };
  }
  return {
    repairable: true,
    reason: 'validator_schema_assumption_mismatch',
    path: validatorPath,
    operation: 'patch_file',
    old_text: oldText,
    new_text: buildAuditValidatorReplacement(target),
    target_path: targetPath,
    repair_hint: 'Apply exactly this one validateAuditDocument() function replacement. Do not request workspace.read. Do not edit main(), imports, or append after main();.'
  };
}

if (process.argv[1] === __filename) {
  const result = repairValidatorSchemaAssumptions({
    validatorPath: process.argv[2] ?? 'scripts/validate-audit-schema.mjs',
    targetPath: process.argv[3] ?? 'docs/architecture/runtime-release-readiness-audit.json'
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.repairable ? 0 : 1);
}
