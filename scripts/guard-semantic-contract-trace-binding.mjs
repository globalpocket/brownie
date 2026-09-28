#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const sourcePath = 'crates/brownie-protocol/src/semantic_contract.rs';
const absoluteSourcePath = path.join(repoRoot, sourcePath);
const source = fs.readFileSync(absoluteSourcePath, 'utf8');

function countMatches(pattern) {
  return [...source.matchAll(pattern)].length;
}

const errors = [];

const validateTraceBindingCount = countMatches(/\bpub\s+fn\s+validate_trace_binding\s*\(/g);
if (validateTraceBindingCount !== 1) {
  errors.push(`expected exactly one pub fn validate_trace_binding, found ${validateTraceBindingCount}`);
}

const cfgTestModuleCount = countMatches(/#\[cfg\(test\)\]\s*\n\s*mod\s+tests\s*\{/g);
if (cfgTestModuleCount !== 1) {
  errors.push(`expected exactly one #[cfg(test)] mod tests in ${sourcePath}, found ${cfgTestModuleCount}`);
}

for (const forbiddenName of ['dispatch_trace_validation', 'dispatch_trace_binding_validation']) {
  if (source.includes(`fn ${forbiddenName}(`)) {
    errors.push(`do not satisfy trace binding dispatch by adding wrapper function ${forbiddenName}; wire validation into method_contract_json instead`);
  }
}

if (!source.includes('"trace_binding_validation": trace_binding_validation')) {
  errors.push('method_contract_json must include a trace_binding_validation field derived from trace_binding_validation_contract(spec)');
}

if (!source.includes('fn trace_binding_validation_contract(spec: &MethodSpec) -> Value')) {
  errors.push('missing trace_binding_validation_contract(spec: &MethodSpec) -> Value helper');
}

if (!source.includes('validate_trace_binding(&trace_id, spec.result_type)')) {
  errors.push('trace_binding_validation_contract must validate the result schema through validate_trace_binding');
}

if (!source.includes('validate_trace_binding(&trace_id, schema_name)')) {
  errors.push('trace_binding_validation_contract must validate request schema names through validate_trace_binding');
}

if (!source.includes('spec.param_type == Some(schema_name) || spec.result_type == schema_name')) {
  errors.push('validate_schema_exists must recognize schemas declared by METHOD_SPECS, not only a hard-coded fixture subset');
}

if (errors.length > 0) {
  console.error('Semantic contract trace binding guard failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Semantic contract trace binding guard passed.');
