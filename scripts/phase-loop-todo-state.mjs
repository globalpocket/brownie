#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateHistoricalDerivedDeliveryReceipt } from './phase-loop-historical-derived-delivery-integrity.mjs';
import { validateMergedDeliveryReverification } from './phase-loop-delivery-integrity.mjs';

function checkboxBlocks(text) {
  const starts = [...String(text ?? '').matchAll(/^(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+/gmu)].map((match) => match.index);
  return starts.map((start, index) => String(text).slice(start, starts[index + 1] ?? String(text).length).trimEnd());
}

export function todoIdFromBlock(block) {
  const firstLine = String(block ?? '').split('\n')[0]?.trim() ?? '';
  return firstLine
    .replace(/^(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+/u, '')
    .split(':')[0]
    ?.trim() || '';
}

function isCheckedBlock(block) {
  return /^(?:[-*]|\d+[.)])\s+\[[xX]\]\s+/u.test(String(block ?? '').trimStart());
}

function readJsonRecords(directory) {
  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    try {
      records.push(JSON.parse(fs.readFileSync(path.join(directory, entry.name), 'utf8')));
    } catch {
      // Invalid durable records grant no state transition. Dedicated guards
      // remain responsible for reporting malformed evidence.
    }
  }
  return records;
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function readTodoReplanRecords(repoRoot) {
  return readJsonRecords(path.join(repoRoot, '.brownie/private/phase-loop/todo-replans')).filter((record) => (
    record?.record_type === 'todo_replan'
    && record?.operation === 'split_parent_into_children'
    && record?.parent_status === 'superseded_by_children'
    && typeof record.parent_todo_id === 'string'
    && Array.isArray(record.generated_child_ids)
  ));
}

export function readTrackedBreakdownReplanRecords(repoRoot, breakdownPath = path.join(repoRoot, '.brownie/todo-breakdown.md')) {
  let text;
  try {
    text = fs.readFileSync(breakdownPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const headings = [...text.matchAll(/^##\s+([^\n]+)\n/gmu)].map((match) => ({
    title: match[1].trim(),
    start: match.index,
    contentStart: match.index + match[0].length
  }));
  const records = [];
  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    const repairPrefix = 'TODO-repair-';
    const noEligibleSuffix = ' no-eligible multi-target split';
    const isRepairSection = current.title.startsWith(repairPrefix);
    const isNoEligibleSplitSection = current.title.endsWith(noEligibleSuffix);
    if (!isRepairSection && !isNoEligibleSplitSection) {
      continue;
    }
    const parentTodoId = isRepairSection
      ? current.title.slice(repairPrefix.length).trim()
      : current.title.slice(0, -noEligibleSuffix.length).trim();
    const section = text.slice(current.contentStart, headings[index + 1]?.start ?? text.length);
    const lines = section.split('\n');
    const childListLabel = isRepairSection ? 'Dependency graph:' : 'Targets:';
    const graphStart = lines.findIndex((line) => line.trim() === childListLabel);
    const childIds = [];
    if (graphStart >= 0) {
      for (const line of lines.slice(graphStart + 1)) {
        if (!line.trim()) {
          continue;
        }
        const match = line.match(/^-\s+([A-Za-z][A-Za-z0-9_.-]*):\s*/u);
        if (!match) {
          break;
        }
        const childId = match[1].trim();
        if (childId !== parentTodoId && !childIds.includes(childId)) {
          childIds.push(childId);
        }
      }
    }
    if (!parentTodoId || childIds.length === 0) {
      continue;
    }
    records.push({
      schema_version: 1,
      record_type: 'todo_replan',
      operation: 'split_parent_into_children',
      parent_status: 'superseded_by_children',
      parent_todo_id: parentTodoId,
      generated_child_ids: childIds,
      generated_leaf_ids: childIds,
      replan_record_reason: isRepairSection
        ? 'tracked_todo_breakdown_repair_section'
        : 'tracked_todo_breakdown_no_eligible_split_section'
    });
  }
  return records;
}

export function readAllTodoReplanRecords(repoRoot, options = {}) {
  return [
    ...readTodoReplanRecords(repoRoot),
    ...readTrackedBreakdownReplanRecords(repoRoot, options.breakdownPath)
  ];
}

export function readTodoCompletionRecords(repoRoot) {
  const records = readJsonRecords(path.join(repoRoot, '.brownie/private/phase-loop/todo-completions')).filter((record) => (
    typeof record?.selected_todo_id === 'string' && record.selected_todo_id.trim()
  ));
  // The writer stores the same receipt by claim id and run stamp for recovery
  // lookup.  They are aliases, not two independent completions.  Collapse an
  // exact logical duplicate before dependency resolution so a legacy recovery
  // report is neither inflated nor ambiguous.  Prefer the newer schema if a
  // claim was rewritten with a durable receipt.
  const byLogicalReceipt = new Map();
  for (const record of records) {
    const claimId = typeof record?.claim_id === 'string' ? record.claim_id.trim() : '';
    const key = claimId
      ? `${record.selected_todo_id.trim()}\u0000${claimId}`
      : `${record.selected_todo_id.trim()}\u0000anonymous\u0000${JSON.stringify(record)}`;
    const existing = byLogicalReceipt.get(key);
    const existingSchema = Number(existing?.schema_version ?? 0);
    const nextSchema = Number(record?.schema_version ?? 0);
    if (!existing || nextSchema > existingSchema) {
      byLogicalReceipt.set(key, record);
    }
  }
  return [...byLogicalReceipt.values()];
}

// A completion record is used to remove a prerequisite from the live queue.
// Schema-v1 records predate the independent-review receipt and therefore
// remain historical evidence only: they must never make an absent prerequisite
// schedulable for a later TODO.  Keep this verifier local and data-only so
// state loading cannot accidentally depend on mutable current-claim state.
export function durableCompletionRecordReceipt(record) {
  const derived = validateHistoricalDerivedDeliveryReceipt(record);
  if (derived.valid) {
    return derived;
  }
  const receipt = record?.delivery_receipt;
  const mergedDelivery = receipt?.merged_delivery_reverification;
  if (mergedDelivery) {
    const attestation = mergedDelivery?.task_attestation;
    // Schema-v3 receipts written before delivery_review was persisted still
    // retain the independent attestation and the compact actor receipt.  Use
    // that immutable pair only when every shared identity field agrees; this
    // makes the transition backward-compatible without treating a detached
    // attestation as completion evidence.
    const recordedReview = receipt?.delivery_review;
    const attestationMatchesCompactReceipt = (
      attestation
      && receipt?.pr_url === attestation.pr_url
      && receipt?.author === attestation.author
      && receipt?.reviewer === attestation.reviewer
      && receipt?.merge_actor === attestation.merge_actor
    );
    const deliveryReview = recordedReview ?? (attestationMatchesCompactReceipt ? {
      pr_url: attestation.pr_url,
      pr_number: attestation.pr_number,
      head_oid: attestation.head_oid
    } : {});
    const selectedTodo = typeof record?.selected_todo === 'string' ? record.selected_todo : '';
    const claim = {
      claim_id: record?.claim_id,
      root_claim_id: record?.root_claim_id ?? record?.claim_id,
      selected_todo: selectedTodo,
      selected_todo_id: record?.selected_todo_id,
      selected_todo_sha256: record?.selected_todo_sha256,
      queue_fingerprint: record?.queue_fingerprint,
      queue_generation: record?.queue_generation,
      delivery_review: deliveryReview
    };
    const proof = validateMergedDeliveryReverification({ claim, evidence: mergedDelivery });
    const valid = (
      record?.schema_version >= 3
      && receipt?.schema_version === 1
      && typeof record?.claim_id === 'string' && record.claim_id
      && receipt.claim_id === record.claim_id
      && receipt.root_claim_id === claim.root_claim_id
      && receipt.selected_todo_sha256 === record.selected_todo_sha256
      && receipt.approved === true
      && receipt.ci_passed === true
      && receipt.merged === true
      // Both receipt shapes keep the compact actor tuple.  When the proof
      // includes an attestation it must agree with that tuple even if the
      // newer delivery_review identity is also present.
      && (!attestation || attestationMatchesCompactReceipt)
      && proof.valid
    );
    return {
      valid,
      reason: valid ? null : 'durable_delivery_receipt_invalid'
    };
  }
  const semantic = receipt?.semantic_completion_evidence;
  const verificationResults = Array.isArray(semantic?.verification_results)
    ? semantic.verification_results
    : [];
  const observables = Array.isArray(semantic?.observables) ? semantic.observables : [];
  const selectedHash = typeof record?.selected_todo_sha256 === 'string'
    ? record.selected_todo_sha256
    : '';
  const rootClaimId = typeof record?.root_claim_id === 'string' && record.root_claim_id
    ? record.root_claim_id
    : record?.claim_id;
  const valid = (
    record?.schema_version >= 2
    && receipt?.schema_version === 1
    && typeof record?.claim_id === 'string' && record.claim_id
    && receipt.claim_id === record.claim_id
    && typeof rootClaimId === 'string' && rootClaimId
    && receipt.root_claim_id === rootClaimId
    && /^[a-f0-9]{64}$/u.test(selectedHash)
    && receipt.selected_todo_sha256 === selectedHash
    && receipt.approved === true
    && receipt.ci_passed === true
    && receipt.merged === true
    && typeof receipt.author === 'string' && receipt.author
    && typeof receipt.reviewer === 'string' && receipt.reviewer
    && receipt.author !== receipt.reviewer
    && receipt.merge_actor === receipt.reviewer
    && semantic?.schema_version === 1
    && semantic.root_claim_id === rootClaimId
    && semantic.selected_todo_sha256 === selectedHash
    && typeof semantic.completion_condition_sha256 === 'string' && /^[a-f0-9]{64}$/u.test(semantic.completion_condition_sha256)
    && verificationResults.length > 0
    && verificationResults.every((result) => result && typeof result.command === 'string' && result.command && result.exit_code === 0)
    && observables.length > 0
    && observables.every((observable) => observable && observable.kind && typeof observable.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(observable.sha256))
  );
  return {
    valid,
    reason: valid
      ? null
      : record?.schema_version >= 2
        ? 'durable_delivery_receipt_invalid'
        : 'legacy_completion_record_without_delivery_receipt'
  };
}

// Completion receipts are append-only.  A later invalidation record is the
// only supported way to retract one: it must name both the TODO and the exact
// completion claim, so a broad TODO-id assertion cannot erase history.
export function readTodoCompletionInvalidationRecords(repoRoot) {
  return readJsonRecords(path.join(repoRoot, '.brownie/private/phase-loop/todo-completion-invalidations')).filter((record) => (
    record?.record_type === 'todo_completion_invalidation'
    && typeof record?.selected_todo_id === 'string' && record.selected_todo_id.trim()
    && typeof record?.invalidated_completion_claim_id === 'string' && record.invalidated_completion_claim_id.trim()
    && typeof record?.reason === 'string' && record.reason.trim()
  ));
}

// A parent split is ordinarily resolved only by all generated children.  This
// separate receipt is the sole narrowly-audited exception: an exact parent was
// cleanly merged before a split lost every child, then Runtime, verification,
// review, CI, and merge were re-observed on a fresh parent claim.  The receipt
// is append-only and intentionally lives beside completion records rather than
// changing the public TODO text or historical replan record.
export function readTodoSupersessionResolutionRecords(repoRoot) {
  return readJsonRecords(path.join(repoRoot, '.brownie/private/phase-loop/todo-supersession-resolutions')).filter((record) => (
    record?.schema_version === 1
    && record?.record_type === 'superseded_parent_clean_merged_delivery_resolution'
    && typeof record?.parent_todo_id === 'string' && record.parent_todo_id.trim()
    && typeof record?.claim_id === 'string' && record.claim_id.trim()
  ));
}

function sameStrings(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function validSupersessionResolution({ resolution, completionRecord, replanRecord, liveIds, supersededIds, completionIds }) {
  const parentId = replanRecord?.parent_todo_id;
  const children = [...(replanRecord?.generated_child_ids ?? [])].sort();
  const receipt = durableCompletionRecordReceipt(completionRecord);
  const proof = completionRecord?.delivery_receipt?.merged_delivery_reverification;
  const git = proof?.git;
  const binding = proof?.task_spec_binding;
  if (!receipt.valid
    || resolution?.reason !== 'orphaned_superseded_parent_clean_merged_delivery_reverified'
    || resolution?.parent_todo_id !== parentId
    || resolution?.parent_todo_sha256 !== completionRecord?.selected_todo_sha256
    || resolution?.claim_id !== completionRecord?.claim_id
    || resolution?.root_claim_id !== completionRecord?.root_claim_id
    || resolution?.completion_record_sha256 !== sha256Json(completionRecord)
    || !sameStrings([...(resolution?.generated_child_ids ?? [])].sort(), children)
    || resolution?.candidate?.selected_todo_id !== parentId
    || resolution?.candidate?.selected_todo_sha256 !== completionRecord?.selected_todo_sha256
    || resolution?.candidate?.merge_commit_oid !== git?.merge_commit_oid
    || resolution?.candidate?.first_parent_oid !== git?.first_parent_oid
    || resolution?.candidate?.head_oid !== git?.head_oid
    || resolution?.candidate?.task_spec_binding?.todo_id !== parentId
    || resolution?.candidate?.task_spec_binding?.selected_todo_sha256 !== completionRecord?.selected_todo_sha256
    || resolution?.candidate?.task_spec_binding?.head_oid !== git?.head_oid
    || binding?.todo_id !== parentId
    || binding?.selected_todo_sha256 !== completionRecord?.selected_todo_sha256
    || binding?.head_oid !== git?.head_oid
    || children.some((childId) => liveIds.has(childId) || supersededIds.has(childId) || completionIds.has(childId))) {
    return false;
  }
  return true;
}

export function resolveTodoState({
  todoText,
  replanRecords = [],
  completionRecords = [],
  completionInvalidationRecords = [],
  supersessionResolutionRecords = []
}) {
  const blocks = checkboxBlocks(todoText);
  const knownIds = new Set();
  const liveIds = new Set();
  const checkedIds = new Set();
  for (const block of blocks) {
    const id = todoIdFromBlock(block);
    if (!id) {
      continue;
    }
    knownIds.add(id);
    liveIds.add(id);
    if (isCheckedBlock(block)) {
      checkedIds.add(id);
    }
  }

  const errors = [];
  const warnings = [];
  const supersededIds = new Set();
  const childrenByParent = new Map();
  const parentByChild = new Map();
  const normalizedReplans = [];
  for (const record of replanRecords) {
    const parentId = typeof record?.parent_todo_id === 'string' ? record.parent_todo_id.trim() : '';
    const childIds = Array.isArray(record?.generated_child_ids)
      ? [...new Set(record.generated_child_ids.map((value) => String(value).trim()).filter(Boolean))]
      : [];
    if (record?.parent_status !== 'superseded_by_children' || !parentId || childIds.length === 0) {
      continue;
    }
    supersededIds.add(parentId);
    knownIds.add(parentId);
    if (!childrenByParent.has(parentId)) {
      childrenByParent.set(parentId, new Set());
    }
    for (const childId of childIds) {
      const existingParent = parentByChild.get(childId);
      if (existingParent && existingParent !== parentId) {
        errors.push({
          code: 'todo_child_has_multiple_parents',
          todo_id: childId,
          parent_todo_ids: [existingParent, parentId]
        });
        continue;
      }
      parentByChild.set(childId, parentId);
      childrenByParent.get(parentId).add(childId);
      knownIds.add(childId);
    }
    normalizedReplans.push({ ...record, parent_todo_id: parentId, generated_child_ids: childIds });
  }

  const completedIds = new Set([...checkedIds].filter((id) => !supersededIds.has(id)));
  const invalidatedCompletionRecords = [];
  const durableCompletionIds = new Set();
  const unverifiedCompletionRecords = [];
  const invalidatedCompletionKeys = new Set(completionInvalidationRecords.map((record) => (
    `${record.selected_todo_id.trim()}\u0000${record.invalidated_completion_claim_id.trim()}`
  )));
  const completionIds = new Set(completionRecords
    .map((record) => typeof record?.selected_todo_id === 'string' ? record.selected_todo_id.trim() : '')
    .filter(Boolean));
  const validSupersessionResolutionClaims = new Set();
  for (const resolution of supersessionResolutionRecords) {
    const replanRecord = normalizedReplans.find((record) => record.parent_todo_id === resolution.parent_todo_id
      && sameStrings([...record.generated_child_ids].sort(), [...(resolution.generated_child_ids ?? [])].sort()));
    const completionRecord = completionRecords.find((record) => (
      record?.selected_todo_id === resolution.parent_todo_id
      && record?.claim_id === resolution.claim_id
    ));
    if (replanRecord && completionRecord && validSupersessionResolution({
      resolution,
      completionRecord,
      replanRecord,
      liveIds,
      supersededIds,
      completionIds
    })) {
      validSupersessionResolutionClaims.add(`${resolution.parent_todo_id}\u0000${resolution.claim_id}`);
    }
  }
  for (const record of completionRecords) {
    const id = typeof record?.selected_todo_id === 'string' ? record.selected_todo_id.trim() : '';
    if (!id) {
      continue;
    }
    const claimId = typeof record?.claim_id === 'string' ? record.claim_id.trim() : '';
    const supersessionResolutionValid = validSupersessionResolutionClaims.has(`${id}\u0000${claimId}`);
    if (record.reason === 'source_parent_completed' || (supersededIds.has(id) && !supersessionResolutionValid)
      || (claimId && invalidatedCompletionKeys.has(`${id}\u0000${claimId}`))) {
      invalidatedCompletionRecords.push(record);
      continue;
    }
    const receipt = durableCompletionRecordReceipt(record);
    if (receipt.valid) {
      durableCompletionIds.add(id);
    } else {
      unverifiedCompletionRecords.push({
        claim_id: claimId || null,
        selected_todo_id: id,
        schema_version: record?.schema_version ?? null,
        reason: receipt.reason
      });
    }
    completedIds.add(id);
    knownIds.add(id);
  }

  // Existing checked queue entries are explicit live state.  The special
  // danger is an *absent* prerequisite that exists only because an old,
  // unverifiable completion record erased it; that exact shape must block
  // descendants until audited recovery restores or invalidates the claim.
  const unverifiedArchivedCompletionIds = new Set(
    unverifiedCompletionRecords
      .map((record) => record.selected_todo_id)
      .filter((id) => !liveIds.has(id) && !durableCompletionIds.has(id))
  );

  const resolvedIds = new Set(completedIds);
  const resolving = new Set();
  function resolveId(id) {
    if (resolvedIds.has(id)) {
      return true;
    }
    if (!supersededIds.has(id) || resolving.has(id)) {
      return false;
    }
    resolving.add(id);
    const children = [...(childrenByParent.get(id) ?? [])];
    const resolved = children.length > 0 && children.every((childId) => resolveId(childId));
    resolving.delete(id);
    if (resolved) {
      resolvedIds.add(id);
    }
    return resolved;
  }
  for (const id of supersededIds) {
    resolveId(id);
  }

  for (const [parentId, children] of childrenByParent) {
    for (const childId of children) {
      if (!liveIds.has(childId) && !completedIds.has(childId) && !supersededIds.has(childId)) {
        warnings.push({
          code: 'superseded_parent_child_has_no_live_or_terminal_state',
          parent_todo_id: parentId,
          child_todo_id: childId
        });
      }
    }
  }

  return {
    knownIds,
    liveIds,
    checkedIds,
    completedIds,
    supersededIds,
    resolvedIds,
    childrenByParent,
    parentByChild,
    replanRecords: normalizedReplans,
    completionRecords,
    completionInvalidationRecords,
    supersessionResolutionRecords,
    supersessionResolvedIds: new Set([...validSupersessionResolutionClaims].map((key) => key.split('\u0000')[0])),
    invalidatedCompletionRecords,
    durableCompletionIds,
    unverifiedCompletionRecords,
    unverifiedArchivedCompletionIds,
    warnings,
    errors
  };
}

export function loadTodoState(repoRoot, todoText, options = {}) {
  return resolveTodoState({
    todoText,
    replanRecords: [
      ...readAllTodoReplanRecords(repoRoot, { breakdownPath: options.breakdownPath }),
      ...(options.additionalReplanRecords ?? [])
    ],
    completionRecords: readTodoCompletionRecords(repoRoot),
    completionInvalidationRecords: readTodoCompletionInvalidationRecords(repoRoot),
    supersessionResolutionRecords: readTodoSupersessionResolutionRecords(repoRoot)
  });
}

export function todoStateSummary(state) {
  return {
    completed_todo_ids: [...state.completedIds].sort(),
    superseded_todo_ids: [...state.supersededIds].sort(),
    resolved_todo_ids: [...state.resolvedIds].sort(),
    invalidated_completion_record_count: state.invalidatedCompletionRecords.length,
    supersession_resolved_todo_ids: [...state.supersessionResolvedIds].sort(),
    unverified_archived_completion_ids: [...state.unverifiedArchivedCompletionIds].sort(),
    warnings: state.warnings,
    errors: state.errors
  };
}
