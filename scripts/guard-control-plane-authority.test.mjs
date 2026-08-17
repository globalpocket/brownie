import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateControlPlaneAuthority } from './guard-control-plane-authority.mjs';

const pointerFiles = [
  '.brownie-control/phase-state.json',
  '.brownie-control/current-phase-prompt.md',
  '.brownie-control/next-phase-prompt.md',
  '.brownie-control/latest-review.md',
  '.brownie-control/stop-reason.md',
  '.codex/tasks/implement-current-phase.md',
  '.codex/tasks/review-and-plan-next-phase.md',
  'docs/architecture/control-plane-authority.md'
];

function withTempRepo(callback) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'brownie-control-plane-'));
  try {
    for (const file of pointerFiles) {
      mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true });
    }
    callback(repoRoot);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

function writePointerRepo(repoRoot, overrides = {}) {
  const files = {
    '.brownie-control/phase-state.json': JSON.stringify(
      {
        project: 'brownie',
        schema_version: 2,
        authoritative: false,
        source_of_truth: 'external_automation_root',
        external_automation_root: '~/.codex/automations/brownie-phase-loop/'
      },
      null,
      2
    ),
    '.brownie-control/current-phase-prompt.md': 'Pointer only. This is not the live prompt. Use ~/.codex/automations/brownie-phase-loop/.',
    '.brownie-control/next-phase-prompt.md': 'Pointer only. This is not the live next prompt. Use ~/.codex/automations/brownie-phase-loop/.',
    '.brownie-control/latest-review.md': 'Pointer only. This is not the live latest review. Use ~/.codex/automations/brownie-phase-loop/.',
    '.brownie-control/stop-reason.md': 'Pointer only. This is not the live stop reason. Use ~/.codex/automations/brownie-phase-loop/.',
    '.codex/tasks/implement-current-phase.md': 'Compatibility pointer. This is not the scheduled controller authority. Use ~/.codex/automations/brownie-phase-loop/.',
    '.codex/tasks/review-and-plan-next-phase.md': 'Compatibility pointer. This is not the scheduled controller authority. Use ~/.codex/automations/brownie-phase-loop/.',
    'docs/architecture/control-plane-authority.md': 'Compatibility pointer contract. Repository files are pointer only. Use ~/.codex/automations/brownie-phase-loop/.',
    ...overrides
  };

  for (const [file, content] of Object.entries(files)) {
    writeFileSync(path.join(repoRoot, file), `${content}\n`);
  }
}

test('accepts pointer-only repository control-plane files', () => {
  withTempRepo((repoRoot) => {
    writePointerRepo(repoRoot);
    const result = validateControlPlaneAuthority({ repoRoot, pointerFiles });
    assert.deepEqual(result.errors, []);
  });
});

test('rejects repo-local phase-state as the only source of truth', () => {
  withTempRepo((repoRoot) => {
    writePointerRepo(repoRoot, {
      '.codex/tasks/review-and-plan-next-phase.md':
        '`.brownie-control/phase-state.json` is the only source of truth for phase loop state.'
    });
    const result = validateControlPlaneAuthority({ repoRoot, pointerFiles });
    assert(result.errors.some((error) => error.includes('only source of truth')));
  });
});

test('rejects legacy live phase state keys', () => {
  withTempRepo((repoRoot) => {
    writePointerRepo(repoRoot, {
      '.brownie-control/phase-state.json': JSON.stringify(
        {
          project: 'brownie',
          authoritative: false,
          source_of_truth: 'external_automation_root',
          external_automation_root: '~/.codex/automations/brownie-phase-loop/',
          current_phase: '3.4.1',
          status: 'ready_to_implement',
          last_reviewed_pr: 35
        },
        null,
        2
      )
    });
    const result = validateControlPlaneAuthority({ repoRoot, pointerFiles });
    assert(result.errors.some((error) => error.includes('current_phase')));
    assert(result.errors.some((error) => error.includes('status')));
    assert(result.errors.some((error) => error.includes('last_reviewed_pr')));
  });
});

test('rejects stale hard-stop status rules', () => {
  withTempRepo((repoRoot) => {
    writePointerRepo(repoRoot, {
      '.codex/tasks/implement-current-phase.md':
        'Pointer only. Use ~/.codex/automations/brownie-phase-loop/. Run only when `phase-state.json.status` is exactly `ready_to_implement`.'
    });
    const result = validateControlPlaneAuthority({ repoRoot, pointerFiles });
    assert(result.errors.some((error) => error.includes('hard-stops on repo-local phase-state status')));
  });
});
