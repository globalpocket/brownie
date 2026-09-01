import assert from 'node:assert/strict';
import test from 'node:test';

import { validateProductCompletionManifest } from './guard-product-completion.mjs';

function validManifest(overrides = {}) {
  return {
    schema_version: 1,
    phase: 'R7.2',
    current_milestone: 'r7_control_plane_authority_and_completion_gates',
    target_capability: 'headless_autonomous_development',
    concrete_capability_transition: 'product_completion_gate_enforced_by_ci',
    project_objective_ref: 'docs/architecture/product-charter.md',
    strategic_capability_mapping: [
      {
        capability: 'headless_autonomous_development',
        relationship: 'Keeps unattended completion decisions tied to Product Charter capability evidence.'
      }
    ],
    exit_criteria: ['Product completion guard rejects weak completion evidence.'],
    behavior_evidence: ['guard fixture tests reject CI-only completion and missing behavior evidence.'],
    product_completion_gate: {
      required: true,
      accepted_capability: ['Executable completion evidence gate.'],
      behavior_evidence: ['node:test fixture coverage for positive and negative completion evidence.'],
      safety_boundary: ['Reads bounded repository manifest JSON only.'],
      non_goals: ['No new RPC or completion report surface.'],
      rejected_alternatives: ['CI-only completion and report-only completion.'],
      technical_debt: ['Future milestones still need product runtime capability work after R7.'],
      next_capability_rationale: ['R7 closeout can follow after the gate is merged and assessed.'],
      release_readiness_scope: {
        runtime_release_dod: ['Runtime-owned task state and replay boundaries are executable.'],
        runtime_boundary_contracts: ['Run Request, Runtime Event, Control Command, and Run Result are bounded.'],
        external_control_plane_responsibilities: ['Schedulers and worker leases remain outside Runtime release.'],
        external_adapter_responsibilities: ['PR creation and notification adapters remain outside Runtime release.'],
        commercial_solution_readiness: ['Tenant administration and SLA reporting remain commercial readiness.'],
        external_responsibility_not_release_blocking: true
      }
    },
    ...overrides
  };
}

test('accepts bounded product completion evidence', () => {
  const errors = validateProductCompletionManifest(validManifest());
  assert.deepEqual(errors, []);
});

test('rejects CI-only completion evidence', () => {
  const manifest = validManifest({
    concrete_capability_transition: 'CI success and PR merged',
    behavior_evidence: ['CI passed.'],
    product_completion_gate: {
      ...validManifest().product_completion_gate,
      behavior_evidence: ['PR merged with green checks.']
    }
  });
  const errors = validateProductCompletionManifest(manifest);
  assert(errors.some((error) => error.includes('concrete_capability_transition')));
  assert(errors.some((error) => error.includes('behavior evidence')));
});

test('rejects missing Product Charter capability mapping', () => {
  const manifest = validManifest({ strategic_capability_mapping: [] });
  const errors = validateProductCompletionManifest(manifest);
  assert(errors.some((error) => error.includes('strategic_capability_mapping')));
});

test('rejects missing concrete behavior evidence', () => {
  const manifest = validManifest({
    behavior_evidence: [],
    product_completion_gate: {
      ...validManifest().product_completion_gate,
      behavior_evidence: []
    }
  });
  const errors = validateProductCompletionManifest(manifest);
  assert(errors.some((error) => error.includes('behavior evidence')));
});

test('rejects wrapper-only completion without blocker removal', () => {
  const manifest = validManifest({
    product_completion_gate: {
      ...validManifest().product_completion_gate,
      accepted_capability: ['Report-only completion wrapper.']
    }
  });
  const errors = validateProductCompletionManifest(manifest);
  assert(errors.some((error) => error.includes('wrapper/report-style completion claims')));
});

test('allows bounded wrapper-like blocker removal without product completion claim', () => {
  const manifest = validManifest({
    product_completion_gate: {
      ...validManifest().product_completion_gate,
      accepted_capability: ['Report-only blocker-removal wording was removed from completion criteria.'],
      product_completion_claim: false,
      blocker_removal: {
        allowed: true,
        blocker: 'stale report-only completion language blocked reliable phase acceptance'
      }
    }
  });
  const errors = validateProductCompletionManifest(manifest);
  assert.deepEqual(errors, []);
});

test('rejects missing technical debt classification', () => {
  const manifest = validManifest({
    product_completion_gate: {
      ...validManifest().product_completion_gate,
      technical_debt: []
    }
  });
  const errors = validateProductCompletionManifest(manifest);
  assert(errors.some((error) => error.includes('technical_debt')));
});

test('rejects missing release readiness scope', () => {
  const gate = { ...validManifest().product_completion_gate };
  delete gate.release_readiness_scope;
  const errors = validateProductCompletionManifest(validManifest({ product_completion_gate: gate }));
  assert(errors.some((error) => error.includes('release_readiness_scope')));
});

test('rejects external required-before-release debt', () => {
  const manifest = validManifest({
    technical_debt: [
      {
        id: 'scheduler-readiness',
        classification: 'required_before_release',
        responsibility_domain: 'external_control_plane'
      }
    ]
  });
  const errors = validateProductCompletionManifest(manifest);
  assert(errors.some((error) => error.includes('external responsibility items')));
});
