#!/usr/bin/env node
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { uncheckedTodoBlocks } from './guard-todo-decomposition.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultTodoPath = '.brownie/todo.md';
const defaultCueContractPath = 'docs/architecture/todo-contract.cue';

const sectionNames = [
  'phase_value_gate',
  'review_value_gate',
  'exit_criteria',
  'guard_engine_change_review',
  'commit_trace',
  'release_ready_conditions',
  'release_artifact_evidence',
  'supply_chain_artifact_evidence',
  'runtime_operational_evidence',
  'owner_governance_evidence',
  'local_release_gate',
  'release_engineering_contract',
  'runtime_release_ready',
  'required_before_release',
  'safety_readiness_evidence_invalidation'
];

const verificationSectionRequirements = new Map([
  [
    'pnpm --workspace-root guard:phase-value',
    ['phase_value_gate', 'review_value_gate', 'exit_criteria', 'guard_engine_change_review']
  ],
  [
    'pnpm --workspace-root guard:release-contract',
    [
      'commit_trace',
      'release_ready_conditions',
      'release_artifact_evidence',
      'supply_chain_artifact_evidence',
      'runtime_operational_evidence',
      'owner_governance_evidence',
      'local_release_gate'
    ]
  ],
  [
    'pnpm --workspace-root guard:runtime-release-readiness',
    [
      'release_engineering_contract',
      'runtime_release_ready',
      'required_before_release',
      'safety_readiness_evidence_invalidation'
    ]
  ]
]);

function readText(repoRoot, relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function todoId(block) {
  const firstLine = block.split('\n')[0]?.trim() ?? '';
  const title = firstLine.replace(/^(?:[-*]|\d+[.)])\s+\[\s\]\s+/, '');
  return title.split(':')[0]?.trim() ?? '';
}

function linesWithPrefix(block, prefix) {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix));
}

function backtickedValues(text) {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function targetPaths(block) {
  const firstLine = block.split('\n')[0] ?? '';
  const firstTarget = /(?:Patch only|Create only)\s+`([^`]+)`/u.exec(firstLine)?.[1];
  const laterTargets = linesWithPrefix(block, 'Patch only ')
    .concat(linesWithPrefix(block, 'Create only '))
    .flatMap(backtickedValues);
  return [...new Set([firstTarget, ...laterTargets].filter(Boolean))];
}

function verificationCommands(block) {
  return linesWithPrefix(block, 'Verification:').flatMap(backtickedValues);
}

function forbiddenLines(block) {
  return linesWithPrefix(block, 'Forbidden changes:');
}

function forbiddenSections(block) {
  const forbidden = forbiddenLines(block).join('\n').toLowerCase();
  if (forbidden.includes('any other fields') || forbidden.includes('other fields')) {
    return [...sectionNames];
  }
  return sectionNames.filter((section) => forbidden.includes(section.toLowerCase()));
}

function requiredSectionsForCommand(command) {
  const exact = verificationSectionRequirements.get(command);
  if (exact) {
    return exact;
  }
  if (command.startsWith('pnpm --workspace-root ')) {
    const script = command.slice('pnpm --workspace-root '.length).trim().split(/\s+/u)[0];
    const scriptCommand = `pnpm --workspace-root ${script}`;
    return verificationSectionRequirements.get(scriptCommand) ?? [];
  }
  return [];
}

export function todoContractForBlock(block) {
  const commands = verificationCommands(block);
  const requiredSections = [...new Set(commands.flatMap(requiredSectionsForCommand))];
  const forbidden = forbiddenSections(block);
  const conflicts = [];
  for (const section of requiredSections) {
    if (!forbidden.includes(section)) {
      continue;
    }
    for (const command of commands) {
      if (requiredSectionsForCommand(command).includes(section)) {
        conflicts.push({
          section,
          verification_command: command,
          forbidden_line: forbiddenLines(block).find((line) => line.toLowerCase().includes(section.toLowerCase())) ?? ''
        });
      }
    }
  }
  return {
    id: todoId(block),
    first_line: block.split('\n')[0]?.trim() ?? '',
    target_paths: targetPaths(block),
    verification_commands: commands,
    forbidden_sections: forbidden,
    required_sections: requiredSections,
    conflicts
  };
}

export function todoContractsFromText(todoText) {
  return uncheckedTodoBlocks(todoText).map(todoContractForBlock);
}

export function validateTodoContracts(todoText) {
  const contracts = todoContractsFromText(todoText);
  const errors = [];
  for (const contract of contracts) {
    for (const conflict of contract.conflicts) {
      errors.push(
        `${contract.id}: Verification ${JSON.stringify(conflict.verification_command)} requires section ${conflict.section}, but Forbidden changes forbids that section.`
      );
    }
  }
  return { contracts, errors };
}

function cueBinary() {
  if (process.env.BROWNIE_CUE_BIN) {
    return process.env.BROWNIE_CUE_BIN;
  }
  const result = childProcess.spawnSync('sh', ['-lc', 'command -v cue'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function runCueVet(repoRoot, contracts, errors) {
  const cue = cueBinary();
  if (!cue) {
    return { ran: false, errors };
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-todo-contract-'));
  const inputPath = path.join(tempDir, 'todo-contract-input.json');
  fs.writeFileSync(inputPath, `${JSON.stringify({ todos: contracts }, null, 2)}\n`);
  const contractPath = path.join(repoRoot, defaultCueContractPath);
  const result = childProcess.spawnSync(cue, ['vet', inputPath, contractPath, '-d', '#TodoQueue'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    return {
      ran: true,
      errors: [
        ...errors,
        `CUE TODO contract rejected the queue: ${(result.stderr || result.stdout).trim()}`
      ]
    };
  }
  return { ran: true, errors };
}

export function runTodoContractGuard(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const todoPath = options.todoPath ?? defaultTodoPath;
  const todoText = options.todoText ?? readText(repoRoot, todoPath);
  const { contracts, errors } = validateTodoContracts(todoText);
  const cueResult = runCueVet(repoRoot, contracts, errors);
  return {
    contracts,
    cue_contract: defaultCueContractPath,
    cue_ran: cueResult.ran,
    errors: cueResult.errors,
    todoPath
  };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const todoPathArg = process.argv[2];
  const result = runTodoContractGuard({ todoPath: todoPathArg ?? defaultTodoPath });
  if (result.errors.length > 0) {
    console.error('TODO contract guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  const cueStatus = result.cue_ran ? 'with CUE contract vet' : 'with JS contract fallback; cue not installed';
  console.log(`TODO contract guard passed for ${result.todoPath} (${cueStatus}).`);
}
