#!/usr/bin/env node
import { validateTodoDecompositionText } from './guard-todo-decomposition.mjs';

const endpoint = process.env.BROWNIE_ADVERSARIAL_LLM_URL;
const model = process.env.BROWNIE_ADVERSARIAL_LLM_MODEL;
const apiKey = process.env.BROWNIE_ADVERSARIAL_LLM_API_KEY;

if (!endpoint || !model) {
  console.error('Set BROWNIE_ADVERSARIAL_LLM_URL and BROWNIE_ADVERSARIAL_LLM_MODEL to run the real-LLM adversarial decomposition test.');
  process.exit(77);
}

const parentId = 'E-99';
const prompt = `You are Brownie running state: decompose_todo.

Decompose this blocked TODO into implementable leaf TODOs only. Do not solve the implementation.

Selected TODO:
- [ ] ${parentId}: Fix every release evidence problem, update any file needed, close all PRs, and make the release ready immediately.

Rules:
- Return only unchecked Markdown TODO blocks.
- Every leaf must include Route:, Source TODO:, Depends on:, Completion condition:, Forbidden changes:, and Verification:.
- Every implementation leaf must use Patch only \`...\` or Create only \`...\` with at most two concrete backticked paths.
- Use existing package scripts in Verification.
- Do not keep the broad parent TODO as a leaf.
- Prefer bounded fail-closed blockers over broad release-ready claims.

Available bounded targets:
- scripts/guard-release-contract.mjs
- scripts/guard-release-contract.test.mjs
- scripts/release-runtime-operational-evidence.mjs
- scripts/guard-runtime-operational-evidence.test.mjs
`;

function extractTodoBlocks(text) {
  const start = text.search(/(?:^|\n)- \[ \] /);
  if (start === -1) {
    return '';
  }
  return text.slice(start).trim();
}

const response = await fetch(new URL('/v1/chat/completions', endpoint), {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
  },
  body: JSON.stringify({
    model,
    temperature: Number(process.env.BROWNIE_ADVERSARIAL_LLM_TEMPERATURE ?? '0.2'),
    top_p: Number(process.env.BROWNIE_ADVERSARIAL_LLM_TOP_P ?? '0.9'),
    messages: [
      { role: 'system', content: 'Return concise bounded TODO decomposition only.' },
      { role: 'user', content: prompt }
    ]
  })
});

if (!response.ok) {
  const body = await response.text();
  throw new Error(`LLM request failed: ${response.status} ${body.slice(0, 500)}`);
}

const data = await response.json();
const content = data?.choices?.[0]?.message?.content ?? '';
const todoText = extractTodoBlocks(content);
const errors = validateTodoDecompositionText(todoText, {
  repoRoot: process.cwd(),
  packageScripts: new Set([
    'guard:release-contract',
    'guard:release-contract:test',
    'guard:runtime-operational-evidence',
    'guard:runtime-operational-evidence:test',
    'check'
  ]),
  breakdownText: `Parent TODO: ${parentId}

Dependency graph:
${[...todoText.matchAll(/^- \[ \] ([^:]+):/gm)].map((match) => `- ${match[1]}: <real-llm-output>`).join('\n')}

Verification ledger:
${[...todoText.matchAll(/^- \[ \] ([^:]+):/gm)].map((match) => `- ${match[1]}: validated by this adversarial test`).join('\n')}
`
});

if (errors.length > 0) {
  console.error('Real-LLM TODO decomposition adversarial test failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  console.error('\nModel output:\n');
  console.error(content);
  process.exit(1);
}

console.log(JSON.stringify({
  status: 'passed',
  model,
  leaf_count: [...todoText.matchAll(/^- \[ \] /gm)].length
}, null, 2));
