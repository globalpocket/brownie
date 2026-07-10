import { describe, expect, it } from 'vitest';
import { RuntimeJsonRpcError } from '../runtime/errors';
import { isJsonRpcResponse, isLedgerEventSummary, isLlmHealthResult, isLlmStatusResult, isModeSummary, isPermissionCheckResult, isRunInspectSummary, isProposalApplyCapabilityResult, isProposalApplyDryRunHistoryResult, isProposalApplyDryRunResult, isProposalApproveResult, isProposalAuditTrailResult, isProposalPreflightResult, isProposalReadinessResult, isProposalInspectResult, isProposalListResult, isProposalRejectResult, isProposalReviewBundleResult, isProposalReviewQueueDiagnosticsDigestHistoryResult, isProposalReviewQueueDiagnosticsDigestReportHistoryResult, isProposalReviewQueueDiagnosticsDigestReportResult, isProposalReviewQueueDiagnosticsDigestReportVerdictHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportResult, isProposalReviewQueueDiagnosticsDigestReportVerdictResult, isProposalReviewQueueDiagnosticsDigestResult, isProposalReviewQueueDiagnosticsHistoryResult, isProposalReviewQueueDiagnosticsReportResult, isProposalReviewQueueDiagnosticsResult, isProposalReviewQueueResult, isProposalReviewReportResult, isProposalReviewVerdictResult, isRuntimeConfigGetResult, isRuntimeDiagnosticsResult, isRuntimeStatusResult, isToolExecuteResult, isToolIntentParseResult, isToolPlanResult, type JsonRpcRequest, type JsonRpcResponse } from '../runtime/protocol';
import { RuntimeClient } from '../runtime/runtimeClient';
import type { RuntimeTransport } from '../runtime/runtimeProcess';

class FakeTransport implements RuntimeTransport {
  requests: JsonRpcRequest[] = [];

  constructor(private readonly response: JsonRpcResponse<unknown>) {}

  async request<T>(request: JsonRpcRequest): Promise<JsonRpcResponse<T>> {
    this.requests.push(request);
    return this.response as JsonRpcResponse<T>;
  }
}


const modeSummary = {
  mode_id: 'orchestrator',
  display_name: 'Orchestrator',
  role_definition: 'Coordinate tasks.',
  permissions: {
    read_only: true,
    workspace_write: false,
    process_exec: false,
    network_access: false,
    service_control: false,
    destructive: false,
    can_spawn_subtasks: true,
  },
};

const taskRecord = {
  task_id: 'task_1',
  run_id: 'run_1',
  goal: 'test goal',
  mode_id: 'orchestrator',
  status: 'Created',
  created_at: '2026-06-26T00:00:00Z',
  updated_at: '2026-06-26T00:00:00Z',
};

describe('protocol validation', () => {
  it('accepts a valid JSON-RPC response', () => {
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, result: { ok: true } })).toBe(true);
  });

  it('rejects invalid JSON-RPC response shapes', () => {
    expect(isJsonRpcResponse(null)).toBe(false);
    expect(isJsonRpcResponse({ jsonrpc: '2.0', result: {} })).toBe(false);
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1 })).toBe(false);
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, error: { code: '1', message: 'bad' } })).toBe(false);
  });

  it('accepts mode summaries and rejects invalid permission shapes', () => {
    expect(isModeSummary(modeSummary)).toBe(true);
    expect(isModeSummary({ ...modeSummary, permissions: { ...modeSummary.permissions, workspace_write: 'false' } })).toBe(false);
  });

  it('accepts runtime.status results with string fields', () => {
    expect(isRuntimeStatusResult({ name: 'brownie-runtime', version: '0.1.0', status: 'Ready' })).toBe(true);
  });

  it('accepts valid llm.status results and rejects missing required fields', () => {
    expect(isLlmStatusResult({ provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, task_run_network_allowed: false, config_source: 'Default', active_profile: null, budget: { max_prompt_chars: 120000, max_messages: 64, request_timeout_ms: 30000, response_preview_chars: 2000 }, sensitive_guard: 'warn' })).toBe(true);
    expect(isLlmStatusResult({ provider: 'Unknown', enabled: false, model: '', base_url: null, reason: 'unknown provider: mystery', strict: true, will_fallback_to_fake: false, task_run_network_allowed: false, config_source: 'Env', active_profile: null, budget: { max_prompt_chars: 120000, max_messages: 64, request_timeout_ms: 30000, response_preview_chars: 2000 }, sensitive_guard: 'warn' })).toBe(true);
    expect(isLlmStatusResult({ provider: 'Fake', enabled: true, model: 'brownie-fake-llm', will_fallback_to_fake: false, task_run_network_allowed: false, config_source: 'Default', budget: { max_prompt_chars: 120000, max_messages: 64, request_timeout_ms: 30000, response_preview_chars: 2000 }, sensitive_guard: 'warn' })).toBe(false);
    expect(isLlmStatusResult({ provider: 'Fake', enabled: true })).toBe(false);
    expect(isLlmStatusResult({ provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, task_run_network_allowed: false, active_profile: null, budget: { max_prompt_chars: 120000, max_messages: 64, request_timeout_ms: 30000, response_preview_chars: 2000 }, sensitive_guard: 'warn' })).toBe(false);
    expect(isLlmStatusResult({ provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, task_run_network_allowed: false, config_source: 'Default', api_key: 'secret' })).toBe(false);
    expect(isLlmStatusResult({ provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, task_run_network_allowed: false, config_source: 'Default', active_profile: null })).toBe(false);
    expect(isLlmStatusResult({ provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, task_run_network_allowed: false, config_source: 'Default', active_profile: null, budget: { max_prompt_chars: -1, max_messages: 64, request_timeout_ms: 30000, response_preview_chars: 2000 } })).toBe(false);
    expect(isLlmStatusResult({ provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, task_run_network_allowed: false, config_source: 'Default', active_profile: null, budget: { max_prompt_chars: 1.5, max_messages: 64, request_timeout_ms: 30000, response_preview_chars: 2000 } })).toBe(false);
  });

  it('accepts valid runtime diagnostics results', () => {
    const llm_status = { provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, task_run_network_allowed: false, config_source: 'Default', active_profile: null, budget: { max_prompt_chars: 120000, max_messages: 64, request_timeout_ms: 30000, response_preview_chars: 2000 }, sensitive_guard: 'warn' };
    expect(isRuntimeDiagnosticsResult({ config_source: 'Default', active_profile: null, llm_status, parser_config: { max_blocks: 1, max_block_bytes: 16384, max_tool_requests: 8, max_input_bytes: 4096, max_reason_chars: 1000, max_workspace_write_content_chars: 20000 }, diagnostics: [{ severity: 'Info', code: 'CONFIG_NOT_FOUND', message: 'No config.', subject: '.brownie/config.json' }] })).toBe(true);
    expect(isRuntimeDiagnosticsResult({ config_source: 'Default', active_profile: null, llm_status, parser_config: { max_blocks: 1, max_block_bytes: 16384, max_tool_requests: 8, max_input_bytes: 4096, max_reason_chars: 1000, max_workspace_write_content_chars: 20000 }, diagnostics: [{ code: 'CONFIG_NOT_FOUND', message: 'No config.' }] })).toBe(false);
    expect(isRuntimeDiagnosticsResult({ config_source: 'Default', active_profile: null, llm_status, parser_config: { max_blocks: 1, max_block_bytes: 16384, max_tool_requests: 8, max_input_bytes: 4096, max_reason_chars: 1000, max_workspace_write_content_chars: 20000 }, diagnostics: [{ severity: 'Info', message: 'No config.' }] })).toBe(false);
    expect(isRuntimeDiagnosticsResult({ config_source: 'Default', active_profile: null, llm_status, parser_config: { max_blocks: 1, max_block_bytes: 16384, max_tool_requests: 8, max_input_bytes: 4096, max_reason_chars: 1000, max_workspace_write_content_chars: 20000 }, diagnostics: [], api_key: 'secret' })).toBe(false);
  });

  it('accepts valid llm.health results and rejects invalid health fields', () => {
    const result = {
      provider: 'Fake',
      config_source: 'Default',
      active_profile: null,
      enabled: true,
      attempted: false,
      healthy: true,
      model: 'brownie-fake-llm',
      base_url: null,
      checked_at: '2026-06-28T00:00:00Z',
      latency_ms: null,
      status_code: null,
      reason: null,
      diagnostics: [{ severity: 'Info', code: 'PROVIDER_FAKE_HEALTHY', message: 'ok', subject: null }],
    };
    expect(isLlmHealthResult(result)).toBe(true);
    expect(isLlmHealthResult({ ...result, attempted: undefined })).toBe(false);
    expect(isLlmHealthResult({ ...result, healthy: undefined })).toBe(false);
    expect(isLlmHealthResult({ ...result, latency_ms: '1' })).toBe(false);
  });

  it('accepts valid runtime.config.get results', () => {
    const llm_status = { provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, task_run_network_allowed: false, config_source: 'Default', active_profile: null, budget: { max_prompt_chars: 120000, max_messages: 64, request_timeout_ms: 30000, response_preview_chars: 2000 }, sensitive_guard: 'warn' };
    expect(isRuntimeConfigGetResult({ config_source: 'Default', config_path: null, active_profile: null, llm_status })).toBe(true);
    expect(isRuntimeConfigGetResult({ config_source: 'Default', llm_status, api_key: 'secret' })).toBe(false);
  });

  it('accepts valid permission.check results', () => {
    expect(isPermissionCheckResult({ mode_id: 'orchestrator', action: 'WriteWorkspace', allowed: false, reason: 'denied' })).toBe(true);
  });

  it('rejects invalid permission.check result shapes', () => {
    expect(isPermissionCheckResult({ mode_id: 'orchestrator', action: 'UnknownAction', allowed: false, reason: 'denied' })).toBe(false);
    expect(isPermissionCheckResult({ mode_id: 'orchestrator', action: 'WriteWorkspace', allowed: 'false', reason: 'denied' })).toBe(false);
  });

  it('accepts valid tool intent parse results and rejects invalid decision shapes', () => {
    const result = {
      mode_id: 'orchestrator',
      parser: { found_blocks: 1, accepted_blocks: 1, accepted_requests: 1, rejected_requests: 0, max_blocks: 1, max_block_bytes: 16384, max_tool_requests: 8, max_input_bytes: 4096, max_reason_chars: 1000, max_workspace_write_content_chars: 20000 },
      items: [{ tool_id: 'workspace.read', required_action: 'ReadWorkspace', allowed: true, reason: 'ok', request_reason: 'need context', input_summary: { has_path: true, field_count: 1 } }],
      rejected: [{ tool_id: null, reason: 'bad json', code: 'malformed_json' }, { reason: 'missing id is ok', code: 'invalid_schema' }],
    };
    expect(isToolIntentParseResult(result)).toBe(true);
    expect(isToolIntentParseResult({ ...result, items: [{ tool_id: 'workspace.read', required_action: 'Nope', allowed: true, reason: 'ok', request_reason: 'need context', input_summary: { has_path: true, field_count: 1 } }] })).toBe(false);
    expect(isToolIntentParseResult({ ...result, items: [{ tool_id: 'workspace.read', required_action: 'ReadWorkspace', allowed: true, reason: 'ok', request_reason: 'need context', input_summary: { has_path: true, field_count: 1 }, input: { path: 'README.md' } }] })).toBe(false);
    expect(isToolIntentParseResult({ ...result, items: [{ tool_id: 'workspace.read', required_action: 'ReadWorkspace', allowed: true, reason: 'ok', request_reason: 'need context' }] })).toBe(false);
    expect(isToolIntentParseResult({ ...result, items: [{ tool_id: 'workspace.read', required_action: 'ReadWorkspace', allowed: true, reason: 'ok', request_reason: 'need context', input_summary: { has_path: true, field_count: -1 } }] })).toBe(false);
  });

  it('accepts valid tool.plan results and rejects invalid item shapes', () => {
    const result = {
      task_id: 'task_1',
      run_id: 'run_1',
      mode_id: 'orchestrator',
      items: [{ tool_id: 'workspace.read', required_action: 'ReadWorkspace', allowed: true, reason: 'ok' }],
    };
    expect(isToolPlanResult(result)).toBe(true);
    expect(isToolPlanResult({ ...result, items: [{ tool_id: 'workspace.read', required_action: 'Nope', allowed: true, reason: 'ok' }] })).toBe(false);
  });

  it('accepts run inspection summaries and sanitized event payloads', () => {
    const summary = {
      run_id: 'run_1',
      task_id: 'task_1',
      status: 'Completed',
      event_count: 3,
      has_tool_execution_completed: true,
      has_second_pass: true,
      final_response_preview: 'done',
      timeline: ['TaskStarted'],
    };
    expect(isRunInspectSummary(summary)).toBe(true);
    expect(isRunInspectSummary({ ...summary, has_second_pass: 'true' })).toBe(false);
    expect(isRunInspectSummary({ ...summary, event_count: -1 })).toBe(false);
    expect(isLedgerEventSummary({
      event_id: 'event_1',
      task_id: 'task_1',
      run_id: 'run_1',
      kind: 'ToolExecutionCompleted',
      timestamp: '2026-06-26T00:00:00Z',
      payload: { output_preview: 'safe', bytes_read: 4, truncated: false },
    })).toBe(true);
  });


  it('accepts proposal.list results and rejects raw content fields', () => {
    const result = {
      run_id: 'run_1',
      proposals: [{ proposal_id: 'proposal_1', path: 'README.md', operation: 'replace_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, approval_status: 'Pending', approval_reason: null, approved_at: null, rejected_at: null, approval_reason_redacted: false }],
    };
    expect(isProposalListResult(result)).toBe(true);
    expect(isProposalListResult({ ...result, proposals: [{ ...result.proposals[0], content: 'full' }] })).toBe(false);
    expect(isProposalListResult({ ...result, proposals: [{ ...result.proposals[0], raw_input: { content: 'full' } }] })).toBe(false);
    expect(isProposalListResult({ ...result, proposals: [{ ...result.proposals[0], absolute_path: '/tmp/README.md' }] })).toBe(false);
    expect(isProposalInspectResult({ proposal: result.proposals[0] })).toBe(true);
    const applyPlan = { proposal_id: 'proposal_1', plan_id: 'plan_1', status: 'Blocked', checklist: [{ name: 'apply_not_enabled', status: 'Fail', reason: 'Patch apply is not implemented in Phase 3.2.' }] };
    expect(isProposalApproveResult({ proposal: { ...result.proposals[0], approval_status: 'Approved', approved_at: '2026-06-30T00:00:00Z', latest_apply_plan: applyPlan }, apply_plan: applyPlan })).toBe(true);
    const snapshot = { proposal_id: 'proposal_1', snapshot_id: 'snapshot_1', path: 'README.md', canonical_path_hash: 'sha256:abc', file_exists: true, file_kind: 'File', file_size_bytes: 3, file_modified_unix_ms: 1780000000000, file_sha256: 'sha256:def', captured_at: '2026-06-30T00:00:00Z', stale: false, stale_reason: null };
    expect(isProposalPreflightResult({ proposal: { ...result.proposals[0], approval_status: 'Approved', approved_at: '2026-06-30T00:00:00Z', latest_snapshot: snapshot, latest_apply_plan: applyPlan }, snapshot, apply_plan: applyPlan })).toBe(true);
    expect(isProposalPreflightResult({ proposal: result.proposals[0], snapshot: { ...snapshot, canonical_path: '/tmp/README.md' }, apply_plan: applyPlan })).toBe(false);
    expect(isProposalPreflightResult({ proposal: result.proposals[0], snapshot: { ...snapshot, raw_input: {} }, apply_plan: applyPlan })).toBe(false);
    const report = { proposal_id: 'proposal_1', report_id: 'report_1', readiness_status: 'Ready', readiness_reason: null, generated_at: '2026-07-01T00:00:00Z', checklist: [{ name: 'apply_not_implemented', status: 'Skipped', reason: 'Patch apply is not implemented in Phase 3.4.' }], summary: 'Ready for final human review. Patch apply is not implemented in Phase 3.4.' };
    expect(isProposalReadinessResult({ proposal: { ...result.proposals[0], approval_status: 'Approved', approved_at: '2026-06-30T00:00:00Z', latest_snapshot: snapshot, latest_apply_plan: applyPlan }, report })).toBe(true);
    expect(isProposalReadinessResult({ proposal: result.proposals[0], report: { ...report, file_content: 'secret' } })).toBe(false);
    expect(isProposalReadinessResult({ proposal: result.proposals[0], report: { ...report, checklist: [{ ...report.checklist[0], diff: 'raw' }] } })).toBe(false);
    const capability = { proposal_id: 'proposal_1', capability_id: 'apply_capability_1', apply_supported: false, apply_enabled: false, mode: 'dry_run_only', reason: 'Patch apply is not implemented in Phase 3.5.', required_gates: ['proposal_valid', 'runtime_apply_supported'], can_apply_now: false, checked_at: '2026-07-01T00:00:00Z', check_count: 2, failed_checks: [], blocked_checks: ['apply_execution_disabled'], checklist: [{ name: 'apply_execution_disabled', status: 'Blocked', reason: 'Patch apply execution is not enabled in Phase 3.5.' }, { name: 'no_raw_content_exposed', status: 'Pass', reason: null }] };
    expect(isProposalApplyCapabilityResult({ proposal: result.proposals[0], capability })).toBe(true);
    expect(isProposalApplyCapabilityResult({ proposal: result.proposals[0], capability: { ...capability, apply_enabled: true } })).toBe(false);
    expect(isProposalApplyCapabilityResult({ proposal: result.proposals[0], capability: { ...capability, raw_input: { patch: 'raw' } } })).toBe(false);
    expect(isProposalApplyCapabilityResult({ proposal: result.proposals[0], capability: { ...capability, checklist: [{ ...capability.checklist[0], diff: 'raw' }] } })).toBe(false);
    const dryRun = { proposal_id: 'proposal_1', dry_run_id: 'apply_dry_run_1', dry_run_status: 'Completed', dry_run_reason: 'Dry run completed without applying a patch or changing workspace files.', checked_at: '2026-07-01T00:00:00Z', required_gates: ['proposal_valid', 'readiness_ready', 'runtime_apply_supported'], check_count: 2, failed_checks: [], blocked_checks: ['apply_execution_disabled'], no_patch_applied: true, apply_executed: false, workspace_files_changed: false, checklist: [{ name: 'apply_execution_disabled', status: 'Blocked', reason: 'Patch apply execution is not enabled in Phase 3.6 dry-run mode.' }, { name: 'workspace_files_unchanged', status: 'Pass', reason: 'Dry-run inspection does not write workspace files.' }] };
    expect(isProposalApplyDryRunResult({ proposal: result.proposals[0], dry_run: dryRun })).toBe(true);
    expect(isProposalApplyDryRunResult({ proposal: result.proposals[0], dry_run: { ...dryRun, apply_executed: true } })).toBe(false);
    expect(isProposalApplyDryRunResult({ proposal: result.proposals[0], dry_run: { ...dryRun, patch: 'raw' } })).toBe(false);
    expect(isProposalApplyDryRunResult({ proposal: result.proposals[0], dry_run: { ...dryRun, checklist: [{ ...dryRun.checklist[0], file_content: 'secret' }] } })).toBe(false);
    const dryRunHistoryEntry = { proposal_id: dryRun.proposal_id, dry_run_id: dryRun.dry_run_id, dry_run_status: dryRun.dry_run_status, dry_run_reason: dryRun.dry_run_reason, checked_at: dryRun.checked_at, required_gates: dryRun.required_gates, check_count: dryRun.check_count, failed_checks: dryRun.failed_checks, blocked_checks: dryRun.blocked_checks, no_patch_applied: true, apply_executed: false, workspace_files_changed: false };
    const dryRunHistory = { proposal_id: 'proposal_1', dry_run_count: 1, latest_dry_run: dryRunHistoryEntry, dry_runs: [dryRunHistoryEntry], generated_at: '2026-07-01T00:01:00Z' };
    expect(isProposalApplyDryRunHistoryResult({ proposal: result.proposals[0], history: dryRunHistory })).toBe(true);
    expect(isProposalApplyDryRunHistoryResult({ proposal: result.proposals[0], history: { ...dryRunHistory, raw_input: { diff: 'raw' } } })).toBe(false);
    expect(isProposalApplyDryRunHistoryResult({ proposal: result.proposals[0], history: { ...dryRunHistory, dry_runs: [{ ...dryRunHistoryEntry, file_content: 'secret' }] } })).toBe(false);
    expect(isProposalApplyDryRunHistoryResult({ proposal: result.proposals[0], history: { ...dryRunHistory, latest_dry_run: { ...dryRunHistoryEntry, apply_executed: true } } })).toBe(false);
    const auditEntry = { event_id: 'event_1', audit_event: 'proposal_created', event_kind: 'WorkspacePatchProposed', timestamp: '2026-07-01T00:00:00Z', proposal_id: 'proposal_1', summary: 'Proposal created with validation status Valid.', metadata: { operation: 'replace_file', path: 'README.md', content_chars: 3, validation_status: 'Valid', diff_redacted: false } };
    const auditTrail = { proposal_id: 'proposal_1', event_count: 1, latest_event: auditEntry, events: [auditEntry], generated_at: '2026-07-01T00:01:00Z' };
    expect(isProposalAuditTrailResult({ proposal: result.proposals[0], audit_trail: auditTrail })).toBe(true);
    expect(isProposalAuditTrailResult({ proposal: result.proposals[0], audit_trail: { ...auditTrail, raw_input: { diff: 'raw' } } })).toBe(false);
    expect(isProposalAuditTrailResult({ proposal: result.proposals[0], audit_trail: { ...auditTrail, events: [{ ...auditEntry, metadata: { ...auditEntry.metadata, patch: 'raw' } }] } })).toBe(false);
    expect(isProposalAuditTrailResult({ proposal: result.proposals[0], audit_trail: { ...auditTrail, latest_event: { ...auditEntry, file_content: 'secret' } } })).toBe(false);
    const reviewSignal = { status: 'Ready', reason: null, generated_at: '2026-07-01T00:00:00Z', source_id: 'report_1' };
    const reviewBundle = { proposal_id: 'proposal_1', review_status: 'Complete', review_reason: 'All proposal review signals are available for final human review.', latest_readiness: reviewSignal, latest_apply_capability: { status: 'false', reason: 'Patch apply is not implemented in Phase 3.5.', generated_at: '2026-07-01T00:00:00Z', source_id: 'apply_capability_1' }, latest_apply_dry_run: { status: 'Completed', reason: 'Dry run completed without applying a patch or changing workspace files.', generated_at: '2026-07-01T00:00:00Z', source_id: 'apply_dry_run_1' }, audit_event_count: 1, latest_audit_event: auditEntry, required_next_actions: [], generated_at: '2026-07-01T00:01:00Z' };
    expect(isProposalReviewBundleResult({ proposal: result.proposals[0], review_bundle: reviewBundle })).toBe(true);
    expect(isProposalReviewBundleResult({ proposal: result.proposals[0], review_bundle: { ...reviewBundle, patch: 'raw' } })).toBe(false);
    expect(isProposalReviewBundleResult({ proposal: result.proposals[0], review_bundle: { ...reviewBundle, latest_readiness: { ...reviewSignal, file_content: 'secret' } } })).toBe(false);
    expect(isProposalReviewBundleResult({ proposal: result.proposals[0], review_bundle: { ...reviewBundle, latest_audit_event: { ...auditEntry, metadata: { diff: 'raw' } } } })).toBe(false);
    const reviewVerdict = { proposal_id: 'proposal_1', verdict_status: 'ReadyForHumanReview', verdict_reason: 'Recorded review evidence supports final human review; patch apply remains unauthorized.', evidence_status: 'Complete', blocking_reasons: [], missing_signals: [], latest_review_bundle_status: 'Complete', apply_authorized: false, generated_at: '2026-07-01T00:01:00Z' };
    expect(isProposalReviewVerdictResult({ proposal: result.proposals[0], review_verdict: reviewVerdict })).toBe(true);
    expect(isProposalReviewVerdictResult({ proposal: result.proposals[0], review_verdict: { ...reviewVerdict, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewVerdictResult({ proposal: result.proposals[0], review_verdict: { ...reviewVerdict, patch: 'raw' } })).toBe(false);
    expect(isProposalReviewVerdictResult({ proposal: result.proposals[0], review_verdict: { ...reviewVerdict, blocking_reasons: ['ok', 1] } })).toBe(false);
    const reviewReport = { proposal_id: 'proposal_1', report_status: 'Complete', report_reason: 'Review bundle and verdict are complete for final human review; patch apply remains unauthorized.', review_bundle: reviewBundle, review_verdict: reviewVerdict, audit_event_count: 1, recent_audit_events: [auditEntry], required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:01:00Z' };
    expect(isProposalReviewReportResult({ proposal: result.proposals[0], review_report: reviewReport })).toBe(true);
    expect(isProposalReviewReportResult({ proposal: result.proposals[0], review_report: { ...reviewReport, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewReportResult({ proposal: result.proposals[0], review_report: { ...reviewReport, patch: 'raw' } })).toBe(false);
    expect(isProposalReviewReportResult({ proposal: result.proposals[0], review_report: { ...reviewReport, recent_audit_events: [{ ...auditEntry, metadata: { diff: 'raw' } }] } })).toBe(false);
    const reviewQueue = { run_id: 'run_1', queue_status: 'Complete', queue_reason: 'All proposal review queue items are complete for final human review; patch apply remains unauthorized.', proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, items: [{ proposal_id: 'proposal_1', path: 'README.md', validation_status: 'Valid', approval_status: 'Approved', report_status: 'Complete', report_reason: reviewReport.report_reason, verdict_status: 'ReadyForHumanReview', review_status: 'Complete', audit_event_count: 1, latest_audit_event: auditEntry, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:01:00Z' }], required_next_actions: [], generated_at: '2026-07-01T00:01:00Z' };
    expect(isProposalReviewQueueResult({ review_queue: reviewQueue })).toBe(true);
    expect(isProposalReviewQueueResult({ review_queue: { ...reviewQueue, items: [{ ...reviewQueue.items[0], apply_authorized: true }] } })).toBe(false);
    expect(isProposalReviewQueueResult({ review_queue: { ...reviewQueue, patch: 'raw' } })).toBe(false);
    expect(isProposalReviewQueueResult({ review_queue: { ...reviewQueue, items: [{ ...reviewQueue.items[0], latest_audit_event: { ...auditEntry, metadata: { diff: 'raw' } } }] } })).toBe(false);
    const reviewQueueDiagnostics = { run_id: 'run_1', diagnostics_status: 'Complete', diagnostics_reason: 'Review queue diagnostics are consistent and complete; patch apply remains unauthorized.', queue_status: 'Complete', proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, check_count: 2, failed_checks: [], blocked_checks: [], checks: [{ name: 'queue_counts_match_item_statuses', status: 'Pass', reason: 'queue counts match item statuses' }, { name: 'items_never_authorize_apply', status: 'Pass', reason: 'all queue items keep apply_authorized=false' }], required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:01:00Z' };
    expect(isProposalReviewQueueDiagnosticsResult({ review_queue_diagnostics: reviewQueueDiagnostics })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsResult({ review_queue_diagnostics: { ...reviewQueueDiagnostics, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsResult({ review_queue_diagnostics: { ...reviewQueueDiagnostics, raw_input: { patch: 'raw' } } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsResult({ review_queue_diagnostics: { ...reviewQueueDiagnostics, checks: [{ ...reviewQueueDiagnostics.checks[0], diff: 'raw' }] } })).toBe(false);
    const reviewQueueDiagnosticsHistoryEntry = { diagnostics_id: 'review_queue_diagnostics_1', diagnostics_status: 'Complete', queue_status: 'Complete', proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_checks: [], blocked_checks: [], required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:01:00Z' };
    const reviewQueueDiagnosticsHistory = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest review queue diagnostics are complete; patch apply remains unauthorized.', diagnostics_count: 1, latest_diagnostics: reviewQueueDiagnosticsHistoryEntry, entries: [reviewQueueDiagnosticsHistoryEntry], apply_authorized: false, generated_at: '2026-07-01T00:02:00Z' };
    expect(isProposalReviewQueueDiagnosticsHistoryResult({ review_queue_diagnostics_history: reviewQueueDiagnosticsHistory })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsHistoryResult({ review_queue_diagnostics_history: { ...reviewQueueDiagnosticsHistory, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsHistoryResult({ review_queue_diagnostics_history: { ...reviewQueueDiagnosticsHistory, entries: [{ ...reviewQueueDiagnosticsHistoryEntry, diff: 'raw' }] } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsHistoryResult({ review_queue_diagnostics_history: { ...reviewQueueDiagnosticsHistory, diagnostics_count: 2 } })).toBe(false);
    const reviewQueueDiagnosticsReport = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Review queue diagnostics report is complete; patch apply remains unauthorized.', queue_status: 'Complete', diagnostics_status: 'Complete', diagnostics_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_checks: [], blocked_checks: [], required_next_actions: [], latest_diagnostics: reviewQueueDiagnosticsHistoryEntry, apply_authorized: false, generated_at: '2026-07-01T00:03:00Z' };
    expect(isProposalReviewQueueDiagnosticsReportResult({ review_queue_diagnostics_report: reviewQueueDiagnosticsReport })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsReportResult({ review_queue_diagnostics_report: { ...reviewQueueDiagnosticsReport, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsReportResult({ review_queue_diagnostics_report: { ...reviewQueueDiagnosticsReport, raw_input: { patch: 'raw' } } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsReportResult({ review_queue_diagnostics_report: { ...reviewQueueDiagnosticsReport, latest_diagnostics: { ...reviewQueueDiagnosticsHistoryEntry, diff: 'raw' } } })).toBe(false);
    const reviewQueueDiagnosticsDigest = { run_id: 'run_1', digest_status: 'Complete', digest_reason: 'Review queue diagnostics report is complete; patch apply remains unauthorized.', queue_status: 'Complete', diagnostics_status: 'Complete', proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:04:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestResult({ review_queue_diagnostics_digest: reviewQueueDiagnosticsDigest })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestResult({ review_queue_diagnostics_digest: { ...reviewQueueDiagnosticsDigest, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestResult({ review_queue_diagnostics_digest: { ...reviewQueueDiagnosticsDigest, raw_input: { patch: 'raw' } } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestResult({ review_queue_diagnostics_digest: { ...reviewQueueDiagnosticsDigest, required_next_action_count: 1 } })).toBe(false);
    const reviewQueueDiagnosticsDigestHistoryEntry = { digest_id: 'review_queue_digest_1', digest_status: 'Complete', queue_status: 'Complete', diagnostics_status: 'Complete', proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:04:00Z' };
    const reviewQueueDiagnosticsDigestHistory = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest is complete; patch apply remains unauthorized.', digest_count: 1, latest_digest: reviewQueueDiagnosticsDigestHistoryEntry, entries: [reviewQueueDiagnosticsDigestHistoryEntry], apply_authorized: false, generated_at: '2026-07-01T00:05:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestHistoryResult({ review_queue_diagnostics_digest_history: reviewQueueDiagnosticsDigestHistory })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestHistoryResult({ review_queue_diagnostics_digest_history: { ...reviewQueueDiagnosticsDigestHistory, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestHistoryResult({ review_queue_diagnostics_digest_history: { ...reviewQueueDiagnosticsDigestHistory, entries: [{ ...reviewQueueDiagnosticsDigestHistoryEntry, diff: 'raw' }] } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestHistoryResult({ review_queue_diagnostics_digest_history: { ...reviewQueueDiagnosticsDigestHistory, digest_count: 2 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReport = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Diagnostics digest history report is complete; patch apply remains unauthorized.', digest_status: 'Complete', history_status: 'Complete', digest_count: 1, latest_digest: reviewQueueDiagnosticsDigestHistoryEntry, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:06:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportResult({ review_queue_diagnostics_digest_report: reviewQueueDiagnosticsDigestReport })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportResult({ review_queue_diagnostics_digest_report: { ...reviewQueueDiagnosticsDigestReport, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportResult({ review_queue_diagnostics_digest_report: { ...reviewQueueDiagnosticsDigestReport, latest_digest: { ...reviewQueueDiagnosticsDigestHistoryEntry, raw_input: 'raw' } } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportResult({ review_queue_diagnostics_digest_report: { ...reviewQueueDiagnosticsDigestReport, required_next_action_count: 1 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportHistoryEntry = { report_id: 'review_queue_digest_report_1', report_status: 'Complete', digest_status: 'Complete', history_status: 'Complete', digest_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:06:00Z' };
    const reviewQueueDiagnosticsDigestReportHistory = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report is complete; patch apply remains unauthorized.', report_count: 1, latest_report: reviewQueueDiagnosticsDigestReportHistoryEntry, entries: [reviewQueueDiagnosticsDigestReportHistoryEntry], apply_authorized: false, generated_at: '2026-07-01T00:07:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportHistoryResult({ review_queue_diagnostics_digest_report_history: reviewQueueDiagnosticsDigestReportHistory })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportHistoryResult({ review_queue_diagnostics_digest_report_history: { ...reviewQueueDiagnosticsDigestReportHistory, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportHistoryResult({ review_queue_diagnostics_digest_report_history: { ...reviewQueueDiagnosticsDigestReportHistory, entries: [{ ...reviewQueueDiagnosticsDigestReportHistoryEntry, diff: 'raw' }] } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportHistoryResult({ review_queue_diagnostics_digest_report_history: { ...reviewQueueDiagnosticsDigestReportHistory, report_count: 2 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdict = { run_id: 'run_1', verdict_status: 'Complete', verdict_reason: 'Diagnostics digest report chain is complete; patch apply remains unauthorized.', history_status: 'Complete', report_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:08:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictResult({ review_queue_diagnostics_digest_report_verdict: reviewQueueDiagnosticsDigestReportVerdict })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictResult({ review_queue_diagnostics_digest_report_verdict: { ...reviewQueueDiagnosticsDigestReportVerdict, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictResult({ review_queue_diagnostics_digest_report_verdict: { ...reviewQueueDiagnosticsDigestReportVerdict, raw_input: 'raw' } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictResult({ review_queue_diagnostics_digest_report_verdict: { ...reviewQueueDiagnosticsDigestReportVerdict, required_next_action_count: 1 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictHistoryEntry = { verdict_id: 'review_queue_digest_report_verdict_1', verdict_status: 'Complete', history_status: 'Complete', report_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:08:00Z' };
    const reviewQueueDiagnosticsDigestReportVerdictHistory = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict is complete; patch apply remains unauthorized.', verdict_count: 1, latest_verdict: reviewQueueDiagnosticsDigestReportVerdictHistoryEntry, entries: [reviewQueueDiagnosticsDigestReportVerdictHistoryEntry], apply_authorized: false, generated_at: '2026-07-01T00:09:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictHistoryResult({ review_queue_diagnostics_digest_report_verdict_history: reviewQueueDiagnosticsDigestReportVerdictHistory })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictHistoryResult({ review_queue_diagnostics_digest_report_verdict_history: { ...reviewQueueDiagnosticsDigestReportVerdictHistory, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictHistoryResult({ review_queue_diagnostics_digest_report_verdict_history: { ...reviewQueueDiagnosticsDigestReportVerdictHistory, entries: [{ ...reviewQueueDiagnosticsDigestReportVerdictHistoryEntry, raw_input: 'raw' }] } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictHistoryResult({ review_queue_diagnostics_digest_report_verdict_history: { ...reviewQueueDiagnosticsDigestReportVerdictHistory, verdict_count: 2 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictReport = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Diagnostics digest report verdict history is complete; patch apply remains unauthorized.', history_status: 'Complete', verdict_status: 'Complete', verdict_count: 1, latest_verdict: reviewQueueDiagnosticsDigestReportVerdictHistoryEntry, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:10:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportResult({ review_queue_diagnostics_digest_report_verdict_report: reviewQueueDiagnosticsDigestReportVerdictReport })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportResult({ review_queue_diagnostics_digest_report_verdict_report: { ...reviewQueueDiagnosticsDigestReportVerdictReport, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportResult({ review_queue_diagnostics_digest_report_verdict_report: { ...reviewQueueDiagnosticsDigestReportVerdictReport, latest_verdict: { ...reviewQueueDiagnosticsDigestReportVerdictHistoryEntry, diff: 'raw' } } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportResult({ review_queue_diagnostics_digest_report_verdict_report: { ...reviewQueueDiagnosticsDigestReportVerdictReport, required_next_action_count: 1 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryEntry = { report_id: 'review_queue_digest_report_verdict_report_1', report_status: 'Complete', history_status: 'Complete', verdict_status: 'Complete', verdict_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:10:00Z' };
    const reviewQueueDiagnosticsDigestReportVerdictReportHistory = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report is complete; patch apply remains unauthorized.', report_count: 1, latest_report: reviewQueueDiagnosticsDigestReportVerdictReportHistoryEntry, entries: [reviewQueueDiagnosticsDigestReportVerdictReportHistoryEntry], apply_authorized: false, generated_at: '2026-07-01T00:11:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history: reviewQueueDiagnosticsDigestReportVerdictReportHistory })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistory, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistory, entries: [{ ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryEntry, raw_input: 'raw' }] } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistory, report_count: 2 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigest = { run_id: 'run_1', digest_status: 'Complete', digest_reason: 'Diagnostics digest report verdict report history is complete; patch apply remains unauthorized.', history_status: 'Complete', report_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:12:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigest })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigest, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigest, raw_input: 'raw' } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigest, required_next_action_count: 1 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntry = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:12:00Z' };
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistory = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest is complete; patch apply remains unauthorized.', digest_count: 1, latest_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntry, entries: [reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntry], apply_authorized: false, generated_at: '2026-07-01T00:13:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistory })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistory, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistory, entries: [{ ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntry, raw_input: 'raw' }] } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistory, digest_count: 2 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReport = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Diagnostics digest report verdict report history digest history report is complete; patch apply remains unauthorized.', history_status: 'Complete', digest_status: 'Complete', digest_count: 1, latest_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntry, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:14:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReport })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReport, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReport, latest_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntry, diff: 'raw' } } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReport, required_next_action_count: 1 } })).toBe(false);
    expect(isProposalRejectResult({ proposal: { ...result.proposals[0], approval_status: 'Rejected', rejected_at: '2026-06-30T00:00:00Z' } })).toBe(true);
    expect(isProposalApproveResult({ proposal: result.proposals[0], apply_plan: { ...applyPlan, raw_content: 'secret' } })).toBe(false);
    expect(isProposalApproveResult({ proposal: result.proposals[0], apply_plan: { ...applyPlan, canonical_path: '/tmp/README.md' } })).toBe(false);
  });

  it('validates tool.execute results', () => {
    expect(isToolExecuteResult({ tool_id: 'workspace.read', status: 'Completed', output: { content: 'ok' } })).toBe(true);
    expect(isToolExecuteResult({ tool_id: 'workspace.write', status: 'Denied', output: { reason: 'no' } })).toBe(true);
    expect(isToolExecuteResult({ tool_id: 'workspace.read', status: 'Unknown', output: {} })).toBe(false);
  });
});

describe('RuntimeClient', () => {
  it('creates a runtime.status request', async () => {
    const transport = new FakeTransport({
      jsonrpc: '2.0',
      id: 1,
      result: { name: 'brownie-runtime', version: '0.1.0', status: 'Ready' },
    });
    const client = new RuntimeClient(transport);

    await expect(client.status()).resolves.toEqual({
      name: 'brownie-runtime',
      version: '0.1.0',
      status: 'Ready',
    });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'runtime.status' }]);
  });

  it('creates an llm.status request', async () => {
    const result = { provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, task_run_network_allowed: false, config_source: 'Default', active_profile: null, budget: { max_prompt_chars: 120000, max_messages: 64, request_timeout_ms: 30000, response_preview_chars: 2000 }, sensitive_guard: 'warn' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.llmStatus()).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'llm.status' }]);
  });

  it('creates an llm.health request', async () => {
    const result = { provider: 'Fake', config_source: 'Default', active_profile: null, enabled: true, attempted: false, healthy: true, model: 'brownie-fake-llm', base_url: null, checked_at: '2026-06-28T00:00:00Z', latency_ms: null, status_code: null, reason: null, diagnostics: [] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.llmHealth({ allow_network: false })).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'llm.health', params: { allow_network: false } }]);
  });

  it('rejects invalid llm.status results', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { provider: 'Fake', enabled: true } });
    const client = new RuntimeClient(transport);

    await expect(client.llmStatus()).rejects.toThrow('llm.status returned an invalid result');
  });

  it('creates a runtime.diagnostics.get request', async () => {
    const llm_status = { provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, task_run_network_allowed: false, config_source: 'Default', active_profile: null, budget: { max_prompt_chars: 120000, max_messages: 64, request_timeout_ms: 30000, response_preview_chars: 2000 }, sensitive_guard: 'warn' };
    const result = { config_source: 'Default', active_profile: null, llm_status, parser_config: { max_blocks: 1, max_block_bytes: 16384, max_tool_requests: 8, max_input_bytes: 4096, max_reason_chars: 1000, max_workspace_write_content_chars: 20000 }, diagnostics: [] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);
    await expect(client.runtimeDiagnostics()).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'runtime.diagnostics.get' }]);
  });

  it('creates a runtime.config.get request', async () => {
    const llm_status = { provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, task_run_network_allowed: false, config_source: 'Default', active_profile: null, budget: { max_prompt_chars: 120000, max_messages: 64, request_timeout_ms: 30000, response_preview_chars: 2000 }, sensitive_guard: 'warn' };
    const result = { config_source: 'Default', config_path: null, active_profile: null, llm_status };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.runtimeConfig()).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'runtime.config.get' }]);
  });

  it('creates a mode.list request', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { modes: [modeSummary] } });
    const client = new RuntimeClient(transport);

    await expect(client.listModes()).resolves.toEqual([modeSummary]);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'mode.list' }]);
  });

  it('creates a mode.get request', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: modeSummary });
    const client = new RuntimeClient(transport);

    await expect(client.getMode('orchestrator')).resolves.toEqual(modeSummary);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'mode.get', params: { mode_id: 'orchestrator' } }]);
  });

  it('creates a permission.check request', async () => {
    const result = { mode_id: 'orchestrator', action: 'WriteWorkspace', allowed: false, reason: 'Mode orchestrator does not allow workspace writes.' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.checkPermission('orchestrator', 'WriteWorkspace')).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'permission.check', params: { mode_id: 'orchestrator', action: 'WriteWorkspace' } }]);
  });

  it('rejects invalid permission.check results', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { mode_id: 'orchestrator', action: 'UnknownAction', allowed: false, reason: 'bad' } });
    const client = new RuntimeClient(transport);

    await expect(client.checkPermission('orchestrator', 'WriteWorkspace')).rejects.toThrow('permission.check returned an invalid result');
  });

  it('creates a task.start request', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { task_id: 'task_1', run_id: 'run_1', status: 'Created' } });
    const client = new RuntimeClient(transport);

    await expect(client.startTask({ goal: 'test goal', modeId: 'orchestrator' })).resolves.toEqual({ task_id: 'task_1', run_id: 'run_1', status: 'Created' });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'task.start', params: { goal: 'test goal', mode_id: 'orchestrator' } }]);
  });

  it('creates a task.run request', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { task_id: 'task_1', run_id: 'run_1', status: 'Completed' } });
    const client = new RuntimeClient(transport);

    await expect(client.runTask('task_1')).resolves.toEqual({ task_id: 'task_1', run_id: 'run_1', status: 'Completed' });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'task.run', params: { task_id: 'task_1' } }]);
  });

  it('rejects invalid task.run results', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { task_id: 'task_1', run_id: 'run_1', status: 'Unknown' } });
    const client = new RuntimeClient(transport);

    await expect(client.runTask('task_1')).rejects.toThrow('task.run returned an invalid result');
  });

  it('converts task.run JSON-RPC errors into exceptions', async () => {
    const transport = new FakeTransport({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32602, message: 'invalid params: task not found' },
    });
    const client = new RuntimeClient(transport);

    await expect(client.runTask('task_missing')).rejects.toBeInstanceOf(RuntimeJsonRpcError);
  });

  it('creates a task.inspect request', async () => {
    const result = {
      task: { ...taskRecord, status: 'Completed' },
      run: { run_id: 'run_1', task_id: 'task_1', status: 'Completed', event_count: 2, has_tool_execution_completed: true, has_second_pass: true, final_response_preview: 'done', timeline: ['TaskStarted'] },
    };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.inspectTask('task_1')).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'task.inspect', params: { task_id: 'task_1' } }]);
  });

  it('creates a run.inspect request', async () => {
    const run = { run_id: 'run_1', task_id: 'task_1', status: 'Completed', event_count: 2, has_tool_execution_completed: true, has_second_pass: false, final_response_preview: 'done', timeline: ['TaskStarted'] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { run } });
    const client = new RuntimeClient(transport);

    await expect(client.inspectRun('run_1')).resolves.toEqual(run);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'run.inspect', params: { run_id: 'run_1' } }]);
  });

  it('creates a run.events request', async () => {
    const result = { run_id: 'run_1', events: [{ event_id: 'event_1', task_id: 'task_1', run_id: 'run_1', kind: 'TaskStarted', timestamp: '2026-06-26T00:00:00Z', payload: { reason: 'ok' } }] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.getRunEvents('run_1')).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'run.events', params: { run_id: 'run_1' } }]);
  });

  it('creates a tool.intent.parse request', async () => {
    const result = {
      mode_id: 'orchestrator',
      parser: { found_blocks: 1, accepted_blocks: 1, accepted_requests: 1, rejected_requests: 0, max_blocks: 1, max_block_bytes: 16384, max_tool_requests: 8, max_input_bytes: 4096, max_reason_chars: 1000, max_workspace_write_content_chars: 20000 },
      items: [{ tool_id: 'workspace.read', required_action: 'ReadWorkspace', allowed: true, reason: 'ok', request_reason: 'Need context.', input_summary: { has_path: true, field_count: 1 } }],
      rejected: [],
    };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.parseToolIntent('orchestrator', 'content')).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'tool.intent.parse', params: { mode_id: 'orchestrator', assistant_content: 'content' } }]);
  });

  it('rejects invalid tool.intent.parse results', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { mode_id: 'orchestrator', parser: { found_blocks: 1, accepted_blocks: 1, accepted_requests: 1, rejected_requests: 0, max_blocks: 1, max_block_bytes: 16384, max_tool_requests: 8, max_input_bytes: 4096, max_reason_chars: 1000, max_workspace_write_content_chars: 20000 }, items: [{ tool_id: 'workspace.read', required_action: 'Unknown', allowed: true, reason: 'bad', request_reason: 'Need context.', input_summary: { has_path: true, field_count: 1 } }], rejected: [] } });
    const client = new RuntimeClient(transport);

    await expect(client.parseToolIntent('orchestrator', 'content')).rejects.toThrow('tool.intent.parse returned an invalid result');
  });

  it('creates a tool.plan request', async () => {
    const result = {
      task_id: 'task_1',
      run_id: 'run_1',
      mode_id: 'orchestrator',
      items: [{ tool_id: 'workspace.read', required_action: 'ReadWorkspace', allowed: true, reason: 'ok' }],
    };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.planTools('task_1')).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'tool.plan', params: { task_id: 'task_1' } }]);
  });

  it('rejects invalid tool.plan results', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { task_id: 'task_1', run_id: 'run_1', mode_id: 'orchestrator', items: [{ tool_id: 'workspace.read', required_action: 'Unknown', allowed: true, reason: 'bad' }] } });
    const client = new RuntimeClient(transport);

    await expect(client.planTools('task_1')).rejects.toThrow('tool.plan returned an invalid result');
  });


  it('creates a proposal.list request', async () => {
    const result = { run_id: 'run_1', proposals: [{ proposal_id: 'proposal_1', path: 'README.md', operation: 'replace_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, approval_status: 'Pending', approval_reason: null, approved_at: null, rejected_at: null, approval_reason_redacted: false }] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.listProposals('run_1')).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.list', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.inspect request', async () => {
    const result = { proposal: { proposal_id: 'proposal_1', path: 'README.md', operation: 'replace_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, approval_status: 'Pending', approval_reason: null, approved_at: null, rejected_at: null, approval_reason_redacted: false } };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.inspectProposal('run_1', 'proposal_1')).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.inspect', params: { run_id: 'run_1', proposal_id: 'proposal_1' } }]);
  });

  it('creates proposal.approve and proposal.reject requests', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'README.md', operation: 'replace_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const applyPlan = { proposal_id: 'proposal_1', plan_id: 'plan_1', status: 'Blocked', checklist: [{ name: 'apply_not_enabled', status: 'Fail', reason: 'Patch apply is not implemented in Phase 3.2.' }] };
    const approveTransport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, apply_plan: applyPlan } });
    await expect(new RuntimeClient(approveTransport).approveProposal('run_1', 'proposal_1', 'ok')).resolves.toEqual({ proposal, apply_plan: applyPlan });
    expect(approveTransport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.approve', params: { run_id: 'run_1', proposal_id: 'proposal_1', reason: 'ok' } }]);

    const rejected = { ...proposal, approval_status: 'Rejected', approved_at: null, rejected_at: '2026-06-30T00:00:00Z' };
    const rejectTransport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal: rejected } });
    await expect(new RuntimeClient(rejectTransport).rejectProposal('run_1', 'proposal_1', 'no')).resolves.toEqual({ proposal: rejected });
    expect(rejectTransport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reject', params: { run_id: 'run_1', proposal_id: 'proposal_1', reason: 'no' } }]);
  });

  it('creates a proposal.preflight request', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'README.md', operation: 'replace_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const snapshot = { proposal_id: 'proposal_1', snapshot_id: 'snapshot_1', path: 'README.md', canonical_path_hash: 'sha256:abc', file_exists: true, file_kind: 'File', file_size_bytes: 3, file_modified_unix_ms: 1780000000000, file_sha256: 'sha256:def', captured_at: '2026-06-30T00:00:00Z', stale: false, stale_reason: null };
    const applyPlan = { proposal_id: 'proposal_1', plan_id: 'plan_1', status: 'Blocked', checklist: [{ name: 'apply_not_enabled', status: 'Fail', reason: 'Patch apply is not implemented in Phase 3.3.' }] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, snapshot, apply_plan: applyPlan } });
    await expect(new RuntimeClient(transport).preflightProposal('run_1', 'proposal_1')).resolves.toEqual({ proposal, snapshot, apply_plan: applyPlan });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.preflight', params: { run_id: 'run_1', proposal_id: 'proposal_1' } }]);
  });

  it('creates a proposal.readiness request', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'README.md', operation: 'replace_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const report = { proposal_id: 'proposal_1', report_id: 'report_1', readiness_status: 'Ready', readiness_reason: null, generated_at: '2026-07-01T00:00:00Z', checklist: [{ name: 'apply_not_implemented', status: 'Skipped', reason: 'Patch apply is not implemented in Phase 3.4.' }], summary: 'Ready for final human review. Patch apply is not implemented in Phase 3.4.' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, report } });
    await expect(new RuntimeClient(transport).readinessProposal('run_1', 'proposal_1')).resolves.toEqual({ proposal, report });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.readiness', params: { run_id: 'run_1', proposal_id: 'proposal_1' } }]);
  });

  it('creates a proposal.applyCapability request', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'README.md', operation: 'replace_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const capability = { proposal_id: 'proposal_1', capability_id: 'apply_capability_1', apply_supported: false, apply_enabled: false, mode: 'dry_run_only', reason: 'Patch apply is not implemented in Phase 3.5.', required_gates: ['proposal_valid', 'runtime_apply_supported'], can_apply_now: false, checked_at: '2026-07-01T00:00:00Z', check_count: 1, failed_checks: [], blocked_checks: ['apply_execution_disabled'], checklist: [{ name: 'apply_execution_disabled', status: 'Blocked', reason: 'Patch apply execution is not enabled in Phase 3.5.' }] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, capability } });
    await expect(new RuntimeClient(transport).inspectApplyCapability('run_1', 'proposal_1')).resolves.toEqual({ proposal, capability });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.applyCapability', params: { run_id: 'run_1', proposal_id: 'proposal_1' } }]);
  });

  it('creates a proposal.applyDryRun request', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'README.md', operation: 'replace_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const dry_run = { proposal_id: 'proposal_1', dry_run_id: 'apply_dry_run_1', dry_run_status: 'Completed', dry_run_reason: 'Dry run completed without applying a patch or changing workspace files.', checked_at: '2026-07-01T00:00:00Z', required_gates: ['proposal_valid', 'readiness_ready', 'runtime_apply_supported'], check_count: 1, failed_checks: [], blocked_checks: ['apply_execution_disabled'], no_patch_applied: true, apply_executed: false, workspace_files_changed: false, checklist: [{ name: 'apply_execution_disabled', status: 'Blocked', reason: 'Patch apply execution is not enabled in Phase 3.6 dry-run mode.' }] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, dry_run } });
    await expect(new RuntimeClient(transport).applyDryRun('run_1', 'proposal_1')).resolves.toEqual({ proposal, dry_run });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.applyDryRun', params: { run_id: 'run_1', proposal_id: 'proposal_1' } }]);
  });

  it('creates a proposal.applyDryRunHistory request', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'README.md', operation: 'replace_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const entry = { proposal_id: 'proposal_1', dry_run_id: 'apply_dry_run_1', dry_run_status: 'Completed', dry_run_reason: 'Dry run completed without applying a patch or changing workspace files.', checked_at: '2026-07-01T00:00:00Z', required_gates: ['proposal_valid', 'readiness_ready', 'runtime_apply_supported'], check_count: 1, failed_checks: [], blocked_checks: ['apply_execution_disabled'], no_patch_applied: true, apply_executed: false, workspace_files_changed: false };
    const history = { proposal_id: 'proposal_1', dry_run_count: 1, latest_dry_run: entry, dry_runs: [entry], generated_at: '2026-07-01T00:01:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, history } });
    await expect(new RuntimeClient(transport).applyDryRunHistory('run_1', 'proposal_1')).resolves.toEqual({ proposal, history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.applyDryRunHistory', params: { run_id: 'run_1', proposal_id: 'proposal_1' } }]);
  });

  it('creates a proposal.auditTrail request', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'README.md', operation: 'replace_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const entry = { event_id: 'event_1', audit_event: 'proposal_created', event_kind: 'WorkspacePatchProposed', timestamp: '2026-07-01T00:00:00Z', proposal_id: 'proposal_1', summary: 'Proposal created with validation status Valid.', metadata: { operation: 'replace_file', path: 'README.md', content_chars: 3, validation_status: 'Valid', diff_redacted: false } };
    const audit_trail = { proposal_id: 'proposal_1', event_count: 1, latest_event: entry, events: [entry], generated_at: '2026-07-01T00:01:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, audit_trail } });
    await expect(new RuntimeClient(transport).auditTrail('run_1', 'proposal_1')).resolves.toEqual({ proposal, audit_trail });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.auditTrail', params: { run_id: 'run_1', proposal_id: 'proposal_1' } }]);
  });

  it('creates a proposal.reviewBundle request', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'README.md', operation: 'replace_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const entry = { event_id: 'event_1', audit_event: 'apply_dry_run_checked', event_kind: 'WorkspacePatchApplyDryRunChecked', timestamp: '2026-07-01T00:00:00Z', proposal_id: 'proposal_1', summary: 'Apply dry-run check recorded without applying a patch.', metadata: { dry_run_id: 'apply_dry_run_1', no_patch_applied: true, apply_executed: false, workspace_files_changed: false } };
    const review_bundle = { proposal_id: 'proposal_1', review_status: 'Complete', review_reason: 'All proposal review signals are available for final human review.', latest_readiness: { status: 'Ready', reason: null, generated_at: '2026-07-01T00:00:00Z', source_id: 'report_1' }, latest_apply_capability: { status: 'false', reason: 'Patch apply is not implemented in Phase 3.5.', generated_at: '2026-07-01T00:00:00Z', source_id: 'apply_capability_1' }, latest_apply_dry_run: { status: 'Completed', reason: 'Dry run completed without applying a patch or changing workspace files.', generated_at: '2026-07-01T00:00:00Z', source_id: 'apply_dry_run_1' }, audit_event_count: 1, latest_audit_event: entry, required_next_actions: [], generated_at: '2026-07-01T00:01:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, review_bundle } });
    await expect(new RuntimeClient(transport).reviewBundle('run_1', 'proposal_1')).resolves.toEqual({ proposal, review_bundle });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewBundle', params: { run_id: 'run_1', proposal_id: 'proposal_1' } }]);
  });

  it('creates a proposal.reviewVerdict request', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'README.md', operation: 'replace_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const review_verdict = { proposal_id: 'proposal_1', verdict_status: 'ReadyForHumanReview', verdict_reason: 'Recorded review evidence supports final human review; patch apply remains unauthorized.', evidence_status: 'Complete', blocking_reasons: [], missing_signals: [], latest_review_bundle_status: 'Complete', apply_authorized: false, generated_at: '2026-07-01T00:01:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, review_verdict } });
    await expect(new RuntimeClient(transport).reviewVerdict('run_1', 'proposal_1')).resolves.toEqual({ proposal, review_verdict });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewVerdict', params: { run_id: 'run_1', proposal_id: 'proposal_1' } }]);
  });

  it('creates a proposal.reviewReport request', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'README.md', operation: 'replace_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const entry = { event_id: 'event_1', audit_event: 'apply_dry_run_checked', event_kind: 'WorkspacePatchApplyDryRunChecked', timestamp: '2026-07-01T00:00:00Z', proposal_id: 'proposal_1', summary: 'Apply dry-run check recorded without applying a patch.', metadata: { dry_run_id: 'apply_dry_run_1', no_patch_applied: true, apply_executed: false, workspace_files_changed: false } };
    const review_bundle = { proposal_id: 'proposal_1', review_status: 'Complete', review_reason: 'All proposal review signals are available for final human review.', latest_readiness: { status: 'Ready', reason: null, generated_at: '2026-07-01T00:00:00Z', source_id: 'report_1' }, latest_apply_capability: { status: 'false', reason: 'Patch apply is not implemented in Phase 3.5.', generated_at: '2026-07-01T00:00:00Z', source_id: 'apply_capability_1' }, latest_apply_dry_run: { status: 'Completed', reason: 'Dry run completed without applying a patch or changing workspace files.', generated_at: '2026-07-01T00:00:00Z', source_id: 'apply_dry_run_1' }, audit_event_count: 1, latest_audit_event: entry, required_next_actions: [], generated_at: '2026-07-01T00:01:00Z' };
    const review_verdict = { proposal_id: 'proposal_1', verdict_status: 'ReadyForHumanReview', verdict_reason: 'Recorded review evidence supports final human review; patch apply remains unauthorized.', evidence_status: 'Complete', blocking_reasons: [], missing_signals: [], latest_review_bundle_status: 'Complete', apply_authorized: false, generated_at: '2026-07-01T00:01:00Z' };
    const review_report = { proposal_id: 'proposal_1', report_status: 'Complete', report_reason: 'Review bundle and verdict are complete for final human review; patch apply remains unauthorized.', review_bundle, review_verdict, audit_event_count: 1, recent_audit_events: [entry], required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:01:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, review_report } });
    await expect(new RuntimeClient(transport).reviewReport('run_1', 'proposal_1')).resolves.toEqual({ proposal, review_report });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewReport', params: { run_id: 'run_1', proposal_id: 'proposal_1' } }]);
  });

  it('creates a proposal.reviewQueue request', async () => {
    const latest_audit_event = { event_id: 'event_1', audit_event: 'apply_dry_run_checked', event_kind: 'WorkspacePatchApplyDryRunChecked', timestamp: '2026-07-01T00:00:00Z', proposal_id: 'proposal_1', summary: 'Apply dry-run check recorded without applying a patch.', metadata: { dry_run_id: 'apply_dry_run_1', no_patch_applied: true, apply_executed: false, workspace_files_changed: false } };
    const review_queue = { run_id: 'run_1', queue_status: 'Complete', queue_reason: 'All proposal review queue items are complete for final human review; patch apply remains unauthorized.', proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, items: [{ proposal_id: 'proposal_1', path: 'README.md', validation_status: 'Valid', approval_status: 'Approved', report_status: 'Complete', report_reason: 'Review bundle and verdict are complete for final human review; patch apply remains unauthorized.', verdict_status: 'ReadyForHumanReview', review_status: 'Complete', audit_event_count: 1, latest_audit_event, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:01:00Z' }], required_next_actions: [], generated_at: '2026-07-01T00:01:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue } });
    await expect(new RuntimeClient(transport).reviewQueue('run_1')).resolves.toEqual({ review_queue });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueue', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnostics request', async () => {
    const review_queue_diagnostics = { run_id: 'run_1', diagnostics_status: 'Complete', diagnostics_reason: 'Review queue diagnostics are consistent and complete; patch apply remains unauthorized.', queue_status: 'Complete', proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, check_count: 2, failed_checks: [], blocked_checks: [], checks: [{ name: 'queue_counts_match_item_statuses', status: 'Pass', reason: 'queue counts match item statuses' }, { name: 'items_never_authorize_apply', status: 'Pass', reason: 'all queue items keep apply_authorized=false' }], required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:01:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnostics('run_1')).resolves.toEqual({ review_queue_diagnostics });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnostics', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsHistory request', async () => {
    const entry = { diagnostics_id: 'review_queue_diagnostics_1', diagnostics_status: 'Complete', queue_status: 'Complete', proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_checks: [], blocked_checks: [], required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:01:00Z' };
    const review_queue_diagnostics_history = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest review queue diagnostics are complete; patch apply remains unauthorized.', diagnostics_count: 1, latest_diagnostics: entry, entries: [entry], apply_authorized: false, generated_at: '2026-07-01T00:02:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_history } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsHistory', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsReport request', async () => {
    const latest_diagnostics = { diagnostics_id: 'review_queue_diagnostics_1', diagnostics_status: 'Complete', queue_status: 'Complete', proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_checks: [], blocked_checks: [], required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:01:00Z' };
    const review_queue_diagnostics_report = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Review queue diagnostics report is complete; patch apply remains unauthorized.', queue_status: 'Complete', diagnostics_status: 'Complete', diagnostics_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_checks: [], blocked_checks: [], required_next_actions: [], latest_diagnostics, apply_authorized: false, generated_at: '2026-07-01T00:03:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_report } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsReport('run_1')).resolves.toEqual({ review_queue_diagnostics_report });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsReport', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigest request', async () => {
    const review_queue_diagnostics_digest = { run_id: 'run_1', digest_status: 'Complete', digest_reason: 'Review queue diagnostics report is complete; patch apply remains unauthorized.', queue_status: 'Complete', diagnostics_status: 'Complete', proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:04:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigest('run_1')).resolves.toEqual({ review_queue_diagnostics_digest });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigest', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestHistory request', async () => {
    const entry = { digest_id: 'review_queue_digest_1', digest_status: 'Complete', queue_status: 'Complete', diagnostics_status: 'Complete', proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:04:00Z' };
    const review_queue_diagnostics_digest_history = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest is complete; patch apply remains unauthorized.', digest_count: 1, latest_digest: entry, entries: [entry], apply_authorized: false, generated_at: '2026-07-01T00:05:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_history } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestHistory', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReport request', async () => {
    const latest_digest = { digest_id: 'review_queue_digest_1', digest_status: 'Complete', queue_status: 'Complete', diagnostics_status: 'Complete', proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:04:00Z' };
    const review_queue_diagnostics_digest_report = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Diagnostics digest history report is complete; patch apply remains unauthorized.', digest_status: 'Complete', history_status: 'Complete', digest_count: 1, latest_digest, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:06:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReport('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReport', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportHistory request', async () => {
    const entry = { report_id: 'review_queue_digest_report_1', report_status: 'Complete', digest_status: 'Complete', history_status: 'Complete', digest_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:06:00Z' };
    const review_queue_diagnostics_digest_report_history = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report is complete; patch apply remains unauthorized.', report_count: 1, latest_report: entry, entries: [entry], apply_authorized: false, generated_at: '2026-07-01T00:07:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_history } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportHistory', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdict request', async () => {
    const review_queue_diagnostics_digest_report_verdict = { run_id: 'run_1', verdict_status: 'Complete', verdict_reason: 'Diagnostics digest report chain is complete; patch apply remains unauthorized.', history_status: 'Complete', report_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:08:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdict('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdict', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictHistory request', async () => {
    const verdict = { verdict_id: 'review_queue_digest_report_verdict_1', verdict_status: 'Complete', history_status: 'Complete', report_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:08:00Z' };
    const review_queue_diagnostics_digest_report_verdict_history = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict is complete; patch apply remains unauthorized.', verdict_count: 1, latest_verdict: verdict, entries: [verdict], apply_authorized: false, generated_at: '2026-07-01T00:09:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_history } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictHistory', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReport request', async () => {
    const latest_verdict = { verdict_id: 'review_queue_digest_report_verdict_1', verdict_status: 'Complete', history_status: 'Complete', report_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:08:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Diagnostics digest report verdict history is complete; patch apply remains unauthorized.', history_status: 'Complete', verdict_status: 'Complete', verdict_count: 1, latest_verdict, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:10:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReport('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReport', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistory request', async () => {
    const latest_report = { report_id: 'review_queue_digest_report_verdict_report_1', report_status: 'Complete', history_status: 'Complete', verdict_status: 'Complete', verdict_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:10:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report is complete; patch apply remains unauthorized.', report_count: 1, latest_report, entries: [latest_report], apply_authorized: false, generated_at: '2026-07-01T00:11:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistory', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigest request', async () => {
    const review_queue_diagnostics_digest_report_verdict_report_history_digest = { run_id: 'run_1', digest_status: 'Complete', digest_reason: 'Diagnostics digest report verdict report history is complete; patch apply remains unauthorized.', history_status: 'Complete', report_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:12:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigest('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigest', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistory request', async () => {
    const latest_digest = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:12:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest is complete; patch apply remains unauthorized.', digest_count: 1, latest_digest, entries: [latest_digest], apply_authorized: false, generated_at: '2026-07-01T00:13:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistory', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReport request', async () => {
    const latest_digest = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:12:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Diagnostics digest report verdict report history digest history report is complete; patch apply remains unauthorized.', history_status: 'Complete', digest_status: 'Complete', digest_count: 1, latest_digest, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:14:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReport('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReport', params: { run_id: 'run_1' } }]);
  });

  it('creates a tool.execute request', async () => {
    const result = {
      tool_id: 'workspace.read',
      status: 'Completed',
      output: { path: 'README.md', content: 'hello', truncated: false, bytes_read: 5 },
    };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.executeTool('orchestrator', 'workspace.read', { path: 'README.md' })).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'tool.execute', params: { mode_id: 'orchestrator', tool_id: 'workspace.read', input: { path: 'README.md' } } }]);
  });

  it('rejects invalid tool.execute results', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { tool_id: 'workspace.read', status: 'Invalid', output: {} } });
    const client = new RuntimeClient(transport);

    await expect(client.executeTool('orchestrator', 'workspace.read', { path: 'README.md' })).rejects.toThrow('tool.execute returned an invalid result');
  });

  it('creates a task.get request', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: taskRecord });
    const client = new RuntimeClient(transport);

    await expect(client.getTask('task_1')).resolves.toEqual(taskRecord);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'task.get', params: { task_id: 'task_1' } }]);
  });

  it('creates a task.list request', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { tasks: [taskRecord] } });
    const client = new RuntimeClient(transport);

    await expect(client.listTasks()).resolves.toEqual([taskRecord]);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'task.list' }]);
  });

  it('converts JSON-RPC error responses into exceptions', async () => {
    const transport = new FakeTransport({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'method not found' },
    });
    const client = new RuntimeClient(transport);

    await expect(client.status()).rejects.toBeInstanceOf(RuntimeJsonRpcError);
  });
});
