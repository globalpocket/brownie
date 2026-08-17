import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');

const requiredPointerFiles = [
  '.brownie-control/phase-state.json',
  '.brownie-control/current-phase-prompt.md',
  '.brownie-control/next-phase-prompt.md',
  '.brownie-control/latest-review.md',
  '.brownie-control/stop-reason.md',
  '.codex/tasks/implement-current-phase.md',
  '.codex/tasks/review-and-plan-next-phase.md',
  'docs/architecture/control-plane-authority.md'
];

const forbiddenTextPatterns = [
  {
    pattern: /\.brownie-control\/phase-state\.json`?\s+is\s+the\s+only\s+source\s+of\s+truth/i,
    reason: 'repo-local phase-state is claimed as the only source of truth'
  },
  {
    pattern: /only\s+source\s+of\s+truth\s+for\s+phase\s+loop\s+state/i,
    reason: 'a repository file claims sole phase-loop authority'
  },
  {
    pattern: /Run\s+only\s+when\s+`?phase-state\.json\.status`?\s+is\s+exactly/i,
    reason: 'a repository task hard-stops on repo-local phase-state status'
  },
  {
    pattern: /current_phase["':\s]+3\.4\.1/i,
    reason: 'legacy Phase 3.4.1 current_phase appears as live text'
  },
  {
    pattern: /Phase\s+3\.4\.1\s+Fix/i,
    reason: 'legacy Phase 3.4.1 prompt appears as current control-plane text'
  },
  {
    pattern: /last_reviewed_pr["':\s]+35/i,
    reason: 'legacy reviewed PR 35 appears as live control-plane text'
  },
  {
    pattern: /review_policy["':\s]+do_not_merge_automatically/i,
    reason: 'legacy permanent no-auto-merge review policy appears as live state'
  },
  {
    pattern: /Never\s+auto-merge\s+a\s+PR/i,
    reason: 'legacy hard-stop merge rule appears outside the current controller contract'
  }
];

const forbiddenLiveStateKeys = [
  'current_phase',
  'status',
  'latest_pr',
  'work_branch',
  'last_reviewed_pr',
  'planning_iteration',
  'implementation_iteration',
  'last_decision',
  'next_strategic_capability',
  'stop_reason'
];

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function readText(repoRoot, relativePath, errors) {
  const normalized = normalizeRelativePath(relativePath);
  const filePath = path.join(repoRoot, normalized);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    errors.push(`${normalized} must exist and be readable: ${error.message}`);
    return '';
  }
}

function validateNoForbiddenText(repoRoot, relativePath, errors) {
  const normalized = normalizeRelativePath(relativePath);
  const text = readText(repoRoot, normalized, errors);
  if (!text) {
    return;
  }
  for (const { pattern, reason } of forbiddenTextPatterns) {
    if (pattern.test(text)) {
      errors.push(`${normalized} contains stale control-plane authority: ${reason}.`);
    }
  }
}

function validatePointerText(repoRoot, relativePath, errors) {
  const normalized = normalizeRelativePath(relativePath);
  const text = readText(repoRoot, normalized, errors);
  if (!text) {
    return;
  }
  if (!text.includes('~/.codex/automations/brownie-phase-loop/')) {
    errors.push(`${normalized} must point to ~/.codex/automations/brownie-phase-loop/.`);
  }
  if (!/not\s+the\s+live|not\s+the\s+scheduled\s+controller\s+authority|compatibility\s+pointer|pointer\s+only/i.test(text)) {
    errors.push(`${normalized} must explicitly state that it is pointer-only or non-authoritative.`);
  }
}

function validatePhaseStatePointer(repoRoot, errors) {
  const relativePath = '.brownie-control/phase-state.json';
  const text = readText(repoRoot, relativePath, errors);
  if (!text) {
    return;
  }

  let state;
  try {
    state = JSON.parse(text);
  } catch (error) {
    errors.push(`${relativePath} must be valid JSON: ${error.message}`);
    return;
  }

  if (state.authoritative !== false) {
    errors.push(`${relativePath} must set authoritative to false.`);
  }
  if (state.source_of_truth !== 'external_automation_root') {
    errors.push(`${relativePath} must set source_of_truth to external_automation_root.`);
  }
  if (state.external_automation_root !== '~/.codex/automations/brownie-phase-loop/') {
    errors.push(`${relativePath} must point to ~/.codex/automations/brownie-phase-loop/.`);
  }
  for (const key of forbiddenLiveStateKeys) {
    if (Object.hasOwn(state, key)) {
      errors.push(`${relativePath} must not contain live scheduled state key ${key}.`);
    }
  }
}

export function validateControlPlaneAuthority(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const pointerFiles = options.pointerFiles ?? requiredPointerFiles;
  const errors = [];

  for (const relativePath of pointerFiles) {
    validateNoForbiddenText(repoRoot, relativePath, errors);
  }

  validatePhaseStatePointer(repoRoot, errors);

  for (const relativePath of pointerFiles.filter((file) => file.endsWith('.md'))) {
    validatePointerText(repoRoot, relativePath, errors);
  }

  return { errors, pointerFiles: pointerFiles.map(normalizeRelativePath) };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const result = validateControlPlaneAuthority();
  if (result.errors.length > 0) {
    console.error('Control-plane authority guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('Control-plane authority guard passed.');
}
