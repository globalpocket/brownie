import { describe, expect, it } from 'vitest';
import { isHeadlessContinueOnceParams, isHeadlessContinueOnceResult, isHeadlessRunAdvanceParams, isHeadlessRunAdvanceResult, isHeadlessRunDriveParams, isHeadlessRunDriveResult, isProgressSnapshot, isProposalApplyResult, isTaskListResult, isTaskRunVerificationRecoveryRepairOutcome, isTaskRunVerificationRecoveryRetryOutcome } from '../runtime/protocol';
import { isCodebaseIndexBuildResult, isCodebaseIndexQueryResult, isCodebaseIndexSelectionReadResult, isCodebaseIndexSnapshotManifest } from '../runtime/protocol';
import { isTaskRunContextBudgetSummary, isTaskRunParams, isTaskRunSelectedIndexPromptContextSummary } from '../runtime/protocol';
import { RuntimeJsonRpcError } from '../runtime/errors';
import { isChildInspectConsumedParentJoinRecoverySummary, isChildInspectParentJoinReadinessSummary, isRecoveryCycleBudgetOutcome, isRecoveryCycleChildProvenance, isRunInspectConsumedParentJoinRecoverySummary, isRunInspectParentJoinReadinessSummary, isTaskInspectResult, isTaskRecord, isTaskRunChildOrchestrationOutcome, isTaskRunParentJoinReadinessOutcome, isTaskRunResult } from '../runtime/protocol';
import { isJsonRpcResponse, isLedgerEventSummary, isLlmHealthResult, isLlmStatusResult, isModeSummary, isPermissionCheckResult, isRunInspectSummary, isProposalApplyCapabilityResult, isProposalApplyDryRunHistoryResult, isProposalApplyDryRunResult, isProposalApproveResult, isProposalAuditTrailResult, isProposalPreflightResult, isProposalReadinessResult, isProposalInspectResult, isProposalListResult, isProposalRejectResult, isProposalReviewBundleResult, isProposalReviewQueueDiagnosticsDigestHistoryResult, isProposalReviewQueueDiagnosticsDigestReportHistoryResult, isProposalReviewQueueDiagnosticsDigestReportResult, isProposalReviewQueueDiagnosticsDigestReportVerdictHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportResult, isProposalReviewQueueDiagnosticsDigestReportVerdictResult, isProposalReviewQueueDiagnosticsDigestResult, isProposalReviewQueueDiagnosticsHistoryResult, isProposalReviewQueueDiagnosticsReportResult, isProposalReviewQueueDiagnosticsResult, isProposalReviewQueueResult, isProposalReviewReportResult, isProposalReviewVerdictResult, isRuntimeConfigGetResult, isRuntimeDiagnosticsResult, isRuntimeStatusResult, isToolExecuteResult, isToolIntentParseResult, isToolPlanResult, type JsonRpcRequest, type JsonRpcResponse } from '../runtime/protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult } from '../runtime/protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult } from '../runtime/protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult } from '../runtime/protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult } from '../runtime/protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult } from '../runtime/protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult } from '../runtime/protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult } from '../runtime/protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult } from '../runtime/protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult } from '../runtime/protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult } from '../runtime/protocol';
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
    codebase_index: true,
  },
};

const taskRecord = {
  task_id: 'task_1',
  run_id: 'run_1',
  goal: 'test goal',
  mode_id: 'orchestrator',
  status: 'Created',
  parent_task_id: null,
  parent_run_id: null,
  source_candidate_id: null,
  source_handoff_envelope_id: null,
  source_handoff_envelope_fingerprint: null,
  source_intent_summary: null,
  created_at: '2026-06-26T00:00:00Z',
  updated_at: '2026-06-26T00:00:00Z',
};

const taskListProgressOverview = {
  source_fingerprint: `sha256:${'b'.repeat(64)}`,
  aggregate_sequence: 20260626000000,
  task_count: 1,
  root_task_ids: ['task_1'],
  runnable_task_ids: ['task_1'],
  blocked_task_ids: [],
  terminal_task_ids: [],
  parent_join_ready_task_ids: [],
  status_counts: {
    created: 1,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  },
  stage_counts: [{ current_stage: 'created', task_count: 1 }],
  next_action_sets: [{ next_action: 'run_task_explicitly', task_count: 1, task_ids: ['task_1'] }],
  blocked_sets: [],
  nodes: [{
    task_id: 'task_1',
    run_id: 'run_1',
    status: 'Created',
    lifecycle_phase: 'created',
    current_stage: 'created',
    next_action: 'run_task_explicitly',
    parent_task_id: null,
    parent_run_id: null,
    child_task_count: 0,
    created_at: '2026-06-26T00:00:00Z',
    updated_at: '2026-06-26T00:00:00Z',
  }],
  edges: [],
};

const taskListResult = {
  tasks: [taskRecord],
  progress_overview: taskListProgressOverview,
};

const childSourceIntentSummary = {
  tool_id: 'subtask.spawn',
  required_action: 'SpawnSubtask',
  request_reason: 'Coordinate child work.',
  input_summary: { has_path: false, field_count: 0 },
};

const recoveryCycleChildProvenance = {
  parent_join_admission_id: 'admission_1',
  parent_join_child_completion_fingerprint: `sha256:${'a'.repeat(64)}`,
  parent_join_child_completion_child_count: 3,
  parent_join_terminal_failed_child_count: 1,
  parent_join_terminal_completed_child_count: 2,
  parent_join_recovery_cycle: true,
  parent_join_recovery_cycle_depth: 2,
};

const recoveryCycleBudgetOutcome = {
  recovery_cycle_budget_status: 'Exceeded',
  parent_join_admission_id: 'admission_budget_1',
  parent_join_recovery_cycle_depth: 3,
  max_recovery_cycle_depth: 2,
  blocked_candidate_count: 1,
  child_materialization_enabled: false,
  child_running_enabled: false,
  next_action: 'stop_recovery_cycle_materialization',
};

const childOrchestrationOutcome = {
  parent_run_id: 'run_parent_1',
  materialized_child_task_ids: ['task_child_1'],
  materialized_child_count: 1,
  queued_child_task_ids: ['task_child_1'],
  queued_child_count: 1,
  child_running_enabled: false,
  next_action: 'run_child_task_explicitly',
};

const parentJoinReadinessOutcome = {
  parent_task_id: 'task_parent_1',
  parent_run_id: 'run_parent_1',
  child_task_id: 'task_child_1',
  child_run_id: 'run_child_1',
  child_terminal_status: 'Completed',
  terminal_controlled_child_count: 1,
  pending_controlled_child_count: 0,
  pending_controlled_child_task_ids: [],
  non_runnable_controlled_child_count: 0,
  non_runnable_controlled_child_task_ids: [],
  parent_join_ready: true,
  parent_running_enabled: false,
  next_action: 'run_parent_task_explicitly',
};

const pendingSiblingParentJoinReadinessOutcome = {
  ...parentJoinReadinessOutcome,
  terminal_controlled_child_count: 1,
  pending_controlled_child_count: 1,
  pending_controlled_child_task_ids: ['task_child_2'],
  parent_join_ready: false,
  next_action: 'run_remaining_child_tasks_explicitly',
};

const nonRunnableSiblingParentJoinReadinessOutcome = {
  ...parentJoinReadinessOutcome,
  terminal_controlled_child_count: 1,
  pending_controlled_child_count: 0,
  pending_controlled_child_task_ids: [],
  non_runnable_controlled_child_count: 1,
  non_runnable_controlled_child_task_ids: ['task_child_2'],
  parent_join_ready: false,
  next_action: 'inspect_non_runnable_child_tasks',
};

const parentInspectJoinReadinessSummary = {
  parent_task_id: 'task_parent_1',
  parent_run_id: 'run_parent_1',
  terminal_controlled_child_count: 1,
  pending_controlled_child_count: 0,
  pending_controlled_child_task_ids: [],
  non_runnable_controlled_child_count: 0,
  non_runnable_controlled_child_task_ids: [],
  parent_join_ready: true,
  parent_running_enabled: false,
  next_action: 'run_parent_task_explicitly',
};

const pendingSiblingParentInspectJoinReadinessSummary = {
  ...parentInspectJoinReadinessSummary,
  terminal_controlled_child_count: 1,
  pending_controlled_child_count: 1,
  pending_controlled_child_task_ids: ['task_child_2'],
  parent_join_ready: false,
  next_action: 'run_remaining_child_tasks_explicitly',
};

const nonRunnableSiblingParentInspectJoinReadinessSummary = {
  ...parentInspectJoinReadinessSummary,
  terminal_controlled_child_count: 1,
  pending_controlled_child_count: 0,
  pending_controlled_child_task_ids: [],
  non_runnable_controlled_child_count: 1,
  non_runnable_controlled_child_task_ids: ['task_child_2'],
  parent_join_ready: false,
  next_action: 'inspect_non_runnable_child_tasks',
};

const childInspectParentJoinReadinessSummary = {
  ...parentInspectJoinReadinessSummary,
  inspected_child_task_id: 'task_child_1',
  inspected_child_run_id: 'run_child_1',
  inspected_child_status: 'Completed',
};

const pendingSiblingChildInspectParentJoinReadinessSummary = {
  ...childInspectParentJoinReadinessSummary,
  terminal_controlled_child_count: 1,
  pending_controlled_child_count: 1,
  pending_controlled_child_task_ids: ['task_child_2'],
  parent_join_ready: false,
  next_action: 'run_remaining_child_tasks_explicitly',
};

const nonRunnableSiblingChildInspectParentJoinReadinessSummary = {
  ...childInspectParentJoinReadinessSummary,
  terminal_controlled_child_count: 1,
  pending_controlled_child_count: 0,
  pending_controlled_child_task_ids: [],
  non_runnable_controlled_child_count: 1,
  non_runnable_controlled_child_task_ids: ['task_child_2'],
  parent_join_ready: false,
  next_action: 'inspect_non_runnable_child_tasks',
};

const childInspectConsumedParentJoinRecoverySummary = {
  parent_task_id: 'task_parent_1',
  parent_run_id: 'run_parent_1',
  inspected_child_task_id: 'task_child_1',
  inspected_child_run_id: 'run_child_1',
  inspected_child_status: 'Completed',
  parent_join_consumed: true,
  consumed_terminal_controlled_child_count: 1,
  continuation_controlled_child_count: 1,
  continuation_runnable_child_count: 1,
  continuation_runnable_child_task_ids: ['task_child_2'],
  continuation_non_runnable_child_count: 0,
  continuation_non_runnable_child_task_ids: [],
  continuation_terminal_child_count: 0,
  parent_running_enabled: false,
  next_action: 'run_continuation_child_tasks_explicitly',
};

const parentInspectConsumedParentJoinRecoverySummary = {
  parent_task_id: 'task_parent_1',
  parent_run_id: 'run_parent_1',
  parent_join_consumed: true,
  consumed_terminal_controlled_child_count: 1,
  continuation_controlled_child_count: 1,
  continuation_runnable_child_count: 1,
  continuation_runnable_child_task_ids: ['task_child_2'],
  continuation_non_runnable_child_count: 0,
  continuation_non_runnable_child_task_ids: [],
  continuation_terminal_child_count: 0,
  parent_running_enabled: false,
  next_action: 'run_continuation_child_tasks_explicitly',
};

const progressSnapshot = {
  lifecycle_phase: 'terminal',
  current_stage: 'completed',
  next_action: 'inspect_terminal_result',
  source_fingerprint: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  event_count: 3,
  agent_loop_terminal_evidence_present: true,
  task_terminal_event_present: true,
  controlled_child_count: 0,
  pending_controlled_child_count: 0,
  terminal_controlled_child_count: 0,
  non_runnable_controlled_child_count: 0,
  verification_state: 'not_required',
  verifier_required: false,
  verifier_failed: false,
  verifier_passed: false,
  recovery_signal_present: false,
  apply_signal_present: false,
  selected_index_context_present: false,
  selected_index_context_count: 0,
};

const baseRunInspectSummary = {
  run_id: 'run_1',
  task_id: 'task_1',
  status: 'Completed',
  progress_snapshot: progressSnapshot,
  child_task_count: 0,
  child_task_ids: [],
  child_tasks: [],
  event_count: 0,
  has_tool_execution_completed: false,
  has_subtask_orchestration_queued: false,
  subtask_queue_count: 0,
  has_subtask_handoff_prepared: false,
  subtask_handoff_count: 0,
  has_subtask_scheduler_readiness: false,
  subtask_scheduler_readiness_count: 0,
  has_subtask_dispatch_plan_prepared: false,
  subtask_dispatch_plan_count: 0,
  has_subtask_dispatch_contract_prepared: false,
  subtask_dispatch_contract_count: 0,
  has_subtask_dispatch_admission_evaluated: false,
  subtask_dispatch_admission_count: 0,
  has_subtask_dispatch_readiness_snapshot: false,
  subtask_dispatch_readiness_snapshot_count: 0,
  has_subtask_dispatcher_guard_verdict: false,
  subtask_dispatcher_guard_verdict_count: 0,
  has_subtask_dispatch_decision: false,
  subtask_dispatch_decision_count: 0,
  has_subtask_dispatch_candidate_manifest: false,
  subtask_dispatch_candidate_manifest_count: 0,
  has_subtask_dispatch_handoff_envelope: false,
  subtask_dispatch_handoff_envelope_count: 0,
  has_second_pass: false,
  timeline: [],
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
      progress_snapshot: progressSnapshot,
      parent_join_readiness_summary: parentInspectJoinReadinessSummary,
      child_task_count: 1,
      child_task_ids: ['task_child_1'],
      child_tasks: [{
        task_id: 'task_child_1',
        run_id: 'run_child_1',
        status: 'Completed',
        parent_task_id: 'task_1',
        parent_run_id: 'run_1',
        source_candidate_id: 'subtask_1',
        source_handoff_envelope_id: 'handoff_1',
        source_handoff_envelope_fingerprint: 'sha256:child',
        event_count: 8,
        has_agent_loop_completed: true,
        completion_final_state: 'Completed',
        completion_summary_preview: 'completed child',
        final_response_preview: 'done',
      }],
      event_count: 3,
      has_tool_execution_completed: true,
      has_subtask_orchestration_queued: true,
      subtask_queue_count: 1,
      has_subtask_handoff_prepared: true,
      subtask_handoff_count: 1,
      has_subtask_scheduler_readiness: true,
      subtask_scheduler_readiness_count: 1,
      has_subtask_dispatch_plan_prepared: true,
      subtask_dispatch_plan_count: 1,
      has_subtask_dispatch_contract_prepared: true,
      subtask_dispatch_contract_count: 1,
      has_subtask_dispatch_admission_evaluated: true,
      subtask_dispatch_admission_count: 1,
      has_subtask_dispatch_readiness_snapshot: true,
      subtask_dispatch_readiness_snapshot_count: 1,
      has_subtask_dispatcher_guard_verdict: true,
      subtask_dispatcher_guard_verdict_count: 1,
      has_subtask_dispatch_decision: true,
      subtask_dispatch_decision_count: 1,
      has_subtask_dispatch_candidate_manifest: true,
      subtask_dispatch_candidate_manifest_count: 1,
      has_subtask_dispatch_handoff_envelope: true,
      subtask_dispatch_handoff_envelope_count: 1,
      has_second_pass: true,
      final_response_preview: 'done',
      timeline: ['TaskStarted'],
    };
    expect(isRunInspectSummary(summary)).toBe(true);
    expect(isRunInspectSummary({ ...summary, has_second_pass: 'true' })).toBe(false);
    expect(isRunInspectSummary({ ...summary, child_task_count: -1 })).toBe(false);
    expect(isRunInspectSummary({ ...summary, child_task_ids: ['task_child_1', 2] })).toBe(false);
    expect(isRunInspectSummary({ ...summary, child_tasks: [] })).toBe(true);
    expect(isRunInspectSummary({ ...summary, child_tasks: [{ ...summary.child_tasks[0], status: 'Nope' }] })).toBe(false);
    expect(isRunInspectSummary({ ...summary, child_tasks: [{ ...summary.child_tasks[0], event_count: -1 }] })).toBe(false);
    expect(isRunInspectSummary({ ...summary, event_count: -1 })).toBe(false);
    expect(isRunInspectSummary({ ...summary, subtask_handoff_count: -1 })).toBe(false);
    expect(isRunInspectSummary({ ...summary, subtask_scheduler_readiness_count: -1 })).toBe(false);
    expect(isRunInspectSummary({ ...summary, subtask_dispatch_plan_count: -1 })).toBe(false);
    expect(isRunInspectSummary({ ...summary, subtask_dispatch_contract_count: -1 })).toBe(false);
    expect(isRunInspectSummary({ ...summary, subtask_dispatch_admission_count: -1 })).toBe(false);
    expect(isRunInspectSummary({ ...summary, subtask_dispatch_readiness_snapshot_count: -1 })).toBe(false);
    expect(isRunInspectSummary({ ...summary, subtask_dispatcher_guard_verdict_count: -1 })).toBe(false);
    expect(isRunInspectSummary({ ...summary, subtask_dispatch_decision_count: -1 })).toBe(false);
    expect(isRunInspectSummary({ ...summary, subtask_dispatch_candidate_manifest_count: -1 })).toBe(false);
    expect(isRunInspectSummary({ ...summary, subtask_dispatch_handoff_envelope_count: -1 })).toBe(false);
    expect(isRunInspectSummary({ ...summary, recovery_cycle_budget_outcome: recoveryCycleBudgetOutcome })).toBe(true);
    expect(isRunInspectSummary({ ...summary, recovery_cycle_budget_outcome: { ...recoveryCycleBudgetOutcome, child_running_enabled: true } })).toBe(false);
    expect(isRunInspectSummary({ ...summary, recovery_cycle_budget_outcome: { ...recoveryCycleBudgetOutcome, command: 'raw' } })).toBe(false);
    expect(isRunInspectSummary({ ...summary, parent_join_readiness_summary: pendingSiblingParentInspectJoinReadinessSummary })).toBe(true);
    expect(isRunInspectSummary({ ...summary, parent_join_readiness_summary: { ...parentInspectJoinReadinessSummary, child_task_id: 'task_child_1' } })).toBe(false);
    expect(isRunInspectSummary({ ...summary, consumed_parent_join_recovery_summary: parentInspectConsumedParentJoinRecoverySummary })).toBe(true);
    expect(isRunInspectSummary({ ...summary, consumed_parent_join_recovery_summary: { ...parentInspectConsumedParentJoinRecoverySummary, inspected_child_task_id: 'task_child_1' } })).toBe(false);
    expect(isProgressSnapshot(progressSnapshot)).toBe(true);
    expect(isProgressSnapshot({ ...progressSnapshot, lifecycle_phase: 'blocked_for_explicit_action', current_stage: 'parent_join_ready', next_action: 'run_parent_task_explicitly' })).toBe(true);
    expect(isProgressSnapshot({ ...progressSnapshot, lifecycle_phase: 'paused' })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, current_stage: 'waiting_for_magic' })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, current_stage: 'waiting_on_child_tasks' })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, current_stage: 'verification_failed' })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, current_stage: 'recovery_available' })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, current_stage: 'index_context_materialized' })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, next_action: 'auto_continue' })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, next_action: 'inspect_verification_failure' })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, next_action: 'none' })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, verification_state: 'stale_failed' })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, verification_state: 'failed', verifier_failed: false })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, verification_state: 'passed', verifier_passed: false })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, verification_state: 'pending', verifier_required: false })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, source_fingerprint: 'not-a-fingerprint' })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, selected_index_context_present: true })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, terminal_event_present: true })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, content: 'raw file content' })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, prompt: 'raw prompt' })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, provider_response: 'raw provider response' })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, stdout: 'raw stdout' })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, command: 'cargo check' })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, env: { TOKEN: 'secret' } })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, absolute_path: '/tmp/file' })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, canonical_path: '/tmp/file' })).toBe(false);
    expect(isProgressSnapshot({ ...progressSnapshot, serialized_request_body: '{}' })).toBe(false);
    expect(isRunInspectSummary({ ...summary, progress_snapshot: { ...progressSnapshot, raw_input: 'nope' } })).toBe(false);
    expect(isTaskListResult(taskListResult)).toBe(true);
    expect(isTaskListResult({ tasks: [taskRecord] })).toBe(false);
    expect(isTaskListResult({ ...taskListResult, progress_overview: { ...taskListProgressOverview, task_count: 2 } })).toBe(false);
    expect(isTaskListResult({ ...taskListResult, progress_overview: { ...taskListProgressOverview, source_fingerprint: 'not-a-fingerprint' } })).toBe(false);
    expect(isTaskListResult({ ...taskListResult, progress_overview: { ...taskListProgressOverview, percentage: 50 } })).toBe(false);
    expect(isTaskListResult({
      ...taskListResult,
      progress_overview: {
        ...taskListProgressOverview,
        next_action_sets: [{ next_action: 'auto_continue', task_count: 1, task_ids: ['task_1'] }],
      },
    })).toBe(false);
    expect(isTaskListResult({
      ...taskListResult,
      progress_overview: {
        ...taskListProgressOverview,
        nodes: [{ ...taskListProgressOverview.nodes[0], event_count: 3 }],
      },
    })).toBe(false);
    const headlessParams = {
      authorize: true,
      expected_progress_fingerprint: taskListProgressOverview.source_fingerprint,
      expected_aggregate_sequence: taskListProgressOverview.aggregate_sequence,
      continuation_id: 'continue.once:1',
    };
    const taskRunResult = {
      task_id: 'task_1',
      run_id: 'run_1',
      status: 'Completed',
      agent_loop: { final_state: 'Completed', completion_summary: 'done' },
    };
    const contextBudget = {
      max_prompt_chars: 4096,
      max_ledger_events: 1,
      max_selected_index_chars: 0,
    };
    const contextBudgetSummary = {
      requested: true,
      max_prompt_chars: 4096,
      max_ledger_events: 1,
      max_selected_index_chars: 0,
      total_events: 4,
      included_events: 1,
      omitted_events: 3,
      selected_index_context_present: false,
      selected_index_content_chars: 0,
      selected_index_materialized_chars: 0,
      selected_index_truncated: false,
      protected_context_chars: 256,
      prompt_chars: 512,
      prompt_within_budget: true,
    };
    const headlessResult = {
      status: 'task_executed',
      decision_id: `headless_decision_${'a'.repeat(32)}`,
      continuation_id: 'continue.once:1',
      selected_task_id: 'task_1',
      selected_run_id: 'run_1',
      candidate_count: 1,
      expected_progress_fingerprint: taskListProgressOverview.source_fingerprint,
      expected_aggregate_sequence: taskListProgressOverview.aggregate_sequence,
      current_progress_fingerprint: taskListProgressOverview.source_fingerprint,
      current_aggregate_sequence: taskListProgressOverview.aggregate_sequence,
      post_progress_fingerprint: `sha256:${'c'.repeat(64)}`,
      post_aggregate_sequence: taskListProgressOverview.aggregate_sequence + 1,
      stale: false,
      replayed: false,
      task_run_result: taskRunResult,
      next_route: {
        kind: 'inspect_progress_overview',
        reason: 'Selected task completed; inspect progress.',
        task_id: 'task_1',
        run_id: 'run_1',
        progress_fingerprint: `sha256:${'c'.repeat(64)}`,
        aggregate_sequence: taskListProgressOverview.aggregate_sequence + 1,
        next_action: 'inspect_progress_overview',
      },
      next_action: 'inspect_progress_overview',
    };
    expect(isHeadlessContinueOnceParams(headlessParams)).toBe(true);
    expect(isHeadlessContinueOnceParams({ ...headlessParams, max_steps: 2 })).toBe(true);
    expect(isHeadlessContinueOnceParams({ ...headlessParams, context_budget: contextBudget })).toBe(true);
    expect(isHeadlessContinueOnceParams({ ...headlessParams, context_budget: { ...contextBudget, max_prompt_chars: 127 } })).toBe(false);
    expect(isHeadlessContinueOnceParams({ ...headlessParams, authorize: false })).toBe(false);
    expect(isHeadlessContinueOnceParams({ ...headlessParams, expected_progress_fingerprint: 'not-a-fingerprint' })).toBe(false);
    expect(isHeadlessContinueOnceParams({ ...headlessParams, max_steps: 0 })).toBe(false);
    expect(isHeadlessContinueOnceParams({ ...headlessParams, max_steps: 4 })).toBe(false);
    expect(isHeadlessContinueOnceParams({ ...headlessParams, command: 'cargo test' })).toBe(false);
    const verificationRecoverySource = {
      source_task_id: 'task_source',
      source_run_id: 'run_source',
      expected_failure_fingerprint: `sha256:${'d'.repeat(64)}`,
      authorize_recovery: true,
    };
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      verification_recovery_source: verificationRecoverySource,
      verification_recovery_goal: 'Recover failed verification',
      verification_recovery_mode_id: 'implementer',
    })).toBe(true);
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      verification_recovery_source: { ...verificationRecoverySource, authorize_recovery: false },
    })).toBe(false);
    const verificationRecoveryRunTarget = {
      recovery_task_id: 'task_recovery',
      recovery_run_id: 'run_recovery',
      source_task_id: 'task_source',
      source_run_id: 'run_source',
      expected_failure_fingerprint: `sha256:${'d'.repeat(64)}`,
      authorize_recovery_run: true,
    };
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      verification_recovery_run_target: verificationRecoveryRunTarget,
    })).toBe(true);
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      verification_recovery_run_target: { ...verificationRecoveryRunTarget, authorize_recovery_run: false },
    })).toBe(false);
    const patchApplyRecoverySource = {
      source_run_id: 'run_patch_source',
      source_proposal_id: 'proposal_patch_1',
      source_apply_id: 'apply_patch_1',
      expected_source_apply_fingerprint: `sha256:${'a'.repeat(64)}`,
      expected_failure_fingerprint: `sha256:${'b'.repeat(64)}`,
      authorize_patch_apply_recovery: true,
    };
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      patch_apply_recovery_source: patchApplyRecoverySource,
      patch_apply_recovery_goal: 'Recover failed patch apply',
      patch_apply_recovery_mode_id: 'implementer',
    })).toBe(true);
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      patch_apply_recovery_source: { ...patchApplyRecoverySource, authorize_patch_apply_recovery: false },
    })).toBe(false);
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      patch_apply_recovery_source: { ...patchApplyRecoverySource, raw_file_content: 'secret body' },
    })).toBe(false);
    const patchApplyRecoveryRunTarget = {
      recovery_task_id: 'task_patch_recovery',
      recovery_run_id: 'run_patch_recovery',
      source_run_id: 'run_patch_source',
      source_proposal_id: 'proposal_patch_1',
      source_apply_id: 'apply_patch_1',
      expected_source_apply_fingerprint: `sha256:${'a'.repeat(64)}`,
      expected_failure_fingerprint: `sha256:${'b'.repeat(64)}`,
      authorize_patch_apply_recovery_run: true,
    };
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      patch_apply_recovery_run_target: patchApplyRecoveryRunTarget,
    })).toBe(true);
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      patch_apply_recovery_run_target: { ...patchApplyRecoveryRunTarget, authorize_patch_apply_recovery_run: false },
    })).toBe(false);
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      patch_apply_recovery_run_target: { ...patchApplyRecoveryRunTarget, expected_failure_fingerprint: 'not-a-fingerprint' },
    })).toBe(false);
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      patch_apply_recovery_run_target: { ...patchApplyRecoveryRunTarget, raw_prompt: 'do not expose' },
    })).toBe(false);
    const patchApplyRecoveryApplyTarget = {
      recovery_task_id: 'task_patch_recovery',
      recovery_run_id: 'run_patch_recovery',
      source_run_id: 'run_patch_source',
      source_proposal_id: 'proposal_patch_1',
      source_apply_id: 'apply_patch_1',
      recovery_proposal_id: 'proposal_patch_recovery',
      expected_source_apply_fingerprint: `sha256:${'a'.repeat(64)}`,
      expected_failure_fingerprint: `sha256:${'b'.repeat(64)}`,
      expected_target_sha256: `sha256:${'c'.repeat(64)}`,
      patch_old_text: 'old bounded hunk',
      patch_new_text: 'new bounded hunk',
      authorize_patch_apply_recovery_apply: true,
    };
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      patch_apply_recovery_apply_target: patchApplyRecoveryApplyTarget,
    })).toBe(true);
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      patch_apply_recovery_apply_target: {
        ...patchApplyRecoveryApplyTarget,
        patch_hunks: [
          { old_text: 'old one', new_text: 'new one' },
          { old_text: 'old two', new_text: 'new two' },
        ],
        patch_old_text: null,
        patch_new_text: null,
      },
    })).toBe(true);
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      patch_apply_recovery_apply_target: { ...patchApplyRecoveryApplyTarget, authorize_patch_apply_recovery_apply: false },
    })).toBe(false);
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      patch_apply_recovery_apply_target: { ...patchApplyRecoveryApplyTarget, expected_target_sha256: 'not-a-fingerprint' },
    })).toBe(false);
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      patch_apply_recovery_apply_target: { ...patchApplyRecoveryApplyTarget, raw_file_content: 'secret body' },
    })).toBe(false);
    const verificationRecoveryApplyTarget = {
      source_task_id: 'task_source',
      source_run_id: 'run_source',
      recovery_task_id: 'task_recovery',
      recovery_run_id: 'run_recovery',
      proposal_id: 'proposal_recovery_1',
      expected_failure_fingerprint: `sha256:${'d'.repeat(64)}`,
      expected_target_sha256: `sha256:${'e'.repeat(64)}`,
      replacement_content: 'bounded replacement',
      authorize_recovery_apply: true,
    };
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      verification_recovery_apply_target: verificationRecoveryApplyTarget,
    })).toBe(true);
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      verification_recovery_apply_target: { ...verificationRecoveryApplyTarget, authorize_recovery_apply: false },
    })).toBe(false);
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      verification_recovery_apply_target: { ...verificationRecoveryApplyTarget, expected_target_sha256: 'not-a-fingerprint' },
    })).toBe(false);
    const llmProviderFailureRetrySource = {
      source_task_id: 'task_provider_source',
      source_run_id: 'run_provider_source',
      expected_failure_fingerprint: `sha256:${'f'.repeat(64)}`,
      authorize_provider_failure_retry: true,
    };
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      llm_provider_failure_retry_source: llmProviderFailureRetrySource,
      llm_provider_failure_retry_goal: 'Retry provider failure',
      llm_provider_failure_retry_mode_id: 'provider-runner',
    })).toBe(true);
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      llm_provider_failure_retry_source: { ...llmProviderFailureRetrySource, authorize_provider_failure_retry: false },
    })).toBe(false);
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      llm_provider_failure_retry_source: { ...llmProviderFailureRetrySource, raw_provider_response: 'secret body' },
    })).toBe(false);
    const llmProviderFailureRetryRunTarget = {
      retry_task_id: 'task_provider_retry',
      retry_run_id: 'run_provider_retry',
      source_task_id: 'task_provider_source',
      source_run_id: 'run_provider_source',
      expected_failure_fingerprint: `sha256:${'f'.repeat(64)}`,
      authorize_provider_failure_retry_run: true,
    };
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      llm_provider_failure_retry_run_target: llmProviderFailureRetryRunTarget,
    })).toBe(true);
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      llm_provider_failure_retry_run_target: { ...llmProviderFailureRetryRunTarget, authorize_provider_failure_retry_run: false },
    })).toBe(false);
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      llm_provider_failure_retry_run_target: { ...llmProviderFailureRetryRunTarget, expected_failure_fingerprint: 'not-a-fingerprint' },
    })).toBe(false);
    expect(isHeadlessContinueOnceParams({
      ...headlessParams,
      llm_provider_failure_retry_run_target: { ...llmProviderFailureRetryRunTarget, raw_prompt: 'do not expose' },
    })).toBe(false);
    expect(isHeadlessContinueOnceResult(headlessResult)).toBe(true);
    const headlessBudgetResult = {
      ...headlessResult,
      continuation_id: 'continue.once:budget',
      max_steps: 2,
      step_count: 1,
      executed_count: 1,
      replayed_count: 0,
      stop_reason: 'explicit_verification_recovery_boundary',
      steps: [{
        step_index: 1,
        status: 'task_executed',
        decision_id: headlessResult.decision_id,
        continuation_id: 'continue.once:budget.step.1',
        selected_task_id: 'task_1',
        selected_run_id: 'run_1',
        candidate_count: 1,
        current_progress_fingerprint: taskListProgressOverview.source_fingerprint,
        current_aggregate_sequence: taskListProgressOverview.aggregate_sequence,
        post_progress_fingerprint: `sha256:${'c'.repeat(64)}`,
        post_aggregate_sequence: taskListProgressOverview.aggregate_sequence + 1,
        replayed: false,
        context_budget: contextBudgetSummary,
        next_route: {
          kind: 'start_verification_recovery_explicitly',
          reason: 'Selected task failed verifier completion.',
          task_id: 'task_1',
          run_id: 'run_1',
          failure_fingerprint: `sha256:${'d'.repeat(64)}`,
          next_action: 'start_verification_recovery_explicitly',
        },
        next_action: 'start_verification_recovery_explicitly',
      }],
      next_route: {
        kind: 'start_verification_recovery_explicitly',
        reason: 'Selected task failed verifier completion.',
        task_id: 'task_1',
        run_id: 'run_1',
        failure_fingerprint: `sha256:${'d'.repeat(64)}`,
        next_action: 'start_verification_recovery_explicitly',
      },
      next_action: 'start_verification_recovery_explicitly',
    };
    expect(isHeadlessContinueOnceResult(headlessBudgetResult)).toBe(true);
    expect(isHeadlessContinueOnceResult({ ...headlessBudgetResult, step_count: 2 })).toBe(false);
    expect(isHeadlessContinueOnceResult({ ...headlessBudgetResult, executed_count: 2 })).toBe(false);
    expect(isHeadlessContinueOnceResult({
      ...headlessBudgetResult,
      steps: [{ ...headlessBudgetResult.steps[0], stdout: 'raw output' }],
    })).toBe(false);
    expect(isHeadlessContinueOnceResult({
      ...headlessResult,
      status: 'task_in_progress',
      replayed: true,
      task_run_result: null,
      next_route: {
        kind: 'inspect_progress_overview',
        reason: 'Selected task is still running.',
        task_id: 'task_1',
        run_id: 'run_1',
        progress_fingerprint: `sha256:${'d'.repeat(64)}`,
        aggregate_sequence: taskListProgressOverview.aggregate_sequence + 1,
        next_action: 'inspect_progress_overview',
      },
    })).toBe(true);
    expect(isHeadlessContinueOnceResult({
      ...headlessResult,
      status: 'task_in_progress',
      selected_task_id: 'task_recovery',
      selected_run_id: 'run_recovery',
      replayed: false,
      task_run_result: null,
      next_route: {
        kind: 'run_recovery_task_explicitly',
        reason: 'Recovery task admitted; run explicitly.',
        task_id: 'task_recovery',
        run_id: 'run_recovery',
        failure_fingerprint: `sha256:${'d'.repeat(64)}`,
        progress_fingerprint: `sha256:${'e'.repeat(64)}`,
        aggregate_sequence: taskListProgressOverview.aggregate_sequence + 1,
        next_action: 'run_recovery_task_explicitly',
      },
      next_action: 'run_recovery_task_explicitly',
    })).toBe(true);
    const llmProviderFailureRetryAdmission = {
      source_task_id: 'task_provider_source',
      source_run_id: 'run_provider_source',
      retry_task_id: 'task_provider_retry',
      retry_run_id: 'run_provider_retry',
      failure_fingerprint: `sha256:${'f'.repeat(64)}`,
      failure_class: 'http_status',
      retryable: true,
      retry_running_enabled: false,
      next_action: 'run_llm_provider_retry_task_explicitly',
      replayed: false,
    };
    expect(isHeadlessContinueOnceResult({
      ...headlessResult,
      status: 'task_in_progress',
      selected_task_id: 'task_provider_retry',
      selected_run_id: 'run_provider_retry',
      replayed: false,
      task_run_result: null,
      llm_provider_failure_retry_admission: llmProviderFailureRetryAdmission,
      next_route: {
        kind: 'run_llm_provider_retry_task_explicitly',
        reason: 'Provider retry task admitted; run explicitly.',
        task_id: 'task_provider_retry',
        run_id: 'run_provider_retry',
        failure_fingerprint: `sha256:${'f'.repeat(64)}`,
        progress_fingerprint: `sha256:${'e'.repeat(64)}`,
        aggregate_sequence: taskListProgressOverview.aggregate_sequence + 1,
        next_action: 'run_llm_provider_retry_task_explicitly',
      },
      next_action: 'run_llm_provider_retry_task_explicitly',
    })).toBe(true);
    expect(isHeadlessContinueOnceResult({
      ...headlessResult,
      status: 'task_in_progress',
      task_run_result: null,
      llm_provider_failure_retry_admission: { ...llmProviderFailureRetryAdmission, raw_prompt: 'do not expose' },
      next_route: {
        kind: 'run_llm_provider_retry_task_explicitly',
        reason: 'Provider retry task admitted; run explicitly.',
        task_id: 'task_provider_retry',
        run_id: 'run_provider_retry',
        failure_fingerprint: `sha256:${'f'.repeat(64)}`,
        next_action: 'run_llm_provider_retry_task_explicitly',
      },
      next_action: 'run_llm_provider_retry_task_explicitly',
    })).toBe(false);
    expect(isHeadlessContinueOnceResult({
      ...headlessResult,
      next_route: { ...headlessResult.next_route, kind: 'run_shell' },
    })).toBe(false);
    expect(isHeadlessContinueOnceResult({
      ...headlessResult,
      next_route: { ...headlessResult.next_route, stdout: 'raw' },
    })).toBe(false);
    expect(isHeadlessContinueOnceResult({
      ...headlessResult,
      next_route: { ...headlessResult.next_route, reason: 'x'.repeat(241) },
    })).toBe(false);
    expect(isHeadlessContinueOnceResult({
      ...headlessResult,
      status: 'stale_progress',
      decision_id: null,
      selected_task_id: null,
      selected_run_id: null,
      task_run_result: null,
      stale: true,
      next_route: {
        kind: 'refresh_progress_overview',
        reason: 'Refresh before continuing.',
        progress_fingerprint: taskListProgressOverview.source_fingerprint,
        aggregate_sequence: taskListProgressOverview.aggregate_sequence,
        next_action: 'refresh_progress_overview',
      },
      next_action: 'refresh_progress_overview',
    })).toBe(true);
    expect(isHeadlessContinueOnceResult({ ...headlessResult, decision_id: 'decision_1' })).toBe(false);
    expect(isHeadlessContinueOnceResult({ ...headlessResult, percentage: 42 })).toBe(false);
    expect(isHeadlessContinueOnceResult({ ...headlessResult, prompt: 'raw prompt' })).toBe(false);
    expect(isHeadlessContinueOnceResult({ ...headlessResult, provider_response: 'raw provider response' })).toBe(false);
    expect(isHeadlessContinueOnceResult({ ...headlessResult, stdout: 'raw stdout' })).toBe(false);
    expect(isHeadlessContinueOnceResult({ ...headlessResult, command: 'cargo test' })).toBe(false);
    expect(isHeadlessContinueOnceResult({ ...headlessResult, env: { TOKEN: 'secret' } })).toBe(false);
    expect(isHeadlessContinueOnceResult({ ...headlessResult, absolute_path: '/tmp/file' })).toBe(false);
    const headlessRunAdvanceParams = {
      authorize: true,
      session_id: 'm17.session',
      advance_id: 'm17.advance.1',
      expected_session_sequence: 1,
      max_steps: 2,
      context_budget: contextBudget,
      expected_progress_fingerprint: taskListProgressOverview.source_fingerprint,
      expected_aggregate_sequence: taskListProgressOverview.aggregate_sequence,
    };
    const terminalCompletionEvidence = {
      final_state: 'Completed',
      task_status: 'Completed',
      completion_result_fingerprint: `sha256:${'9'.repeat(64)}`,
      completion_summary_preview: 'Completed task task_1',
      completion_summary_chars: 21,
      completion_summary_truncated: false,
      final_response_present: true,
      final_response_chars: 21,
      replayed: false,
    };
    const headlessStepWithCompletionEvidence = {
      ...headlessBudgetResult.steps[0],
      terminal_completion_evidence: terminalCompletionEvidence,
    };
    const headlessRunAdvanceResult = {
      status: 'task_executed',
      session_id: 'm17.session',
      advance_id: 'm17.advance.1',
      session_sequence: 1,
      replayed: false,
      start_progress: {
        progress_fingerprint: taskListProgressOverview.source_fingerprint,
        aggregate_sequence: taskListProgressOverview.aggregate_sequence,
      },
      post_progress: {
        progress_fingerprint: `sha256:${'c'.repeat(64)}`,
        aggregate_sequence: taskListProgressOverview.aggregate_sequence + 1,
      },
      max_steps: 2,
      step_count: 1,
      executed_count: 1,
      replayed_count: 0,
      stop_reason: 'explicit_verification_recovery_boundary',
      checkpoint_fingerprint: `sha256:${'e'.repeat(64)}`,
      terminal_completion_evidence: terminalCompletionEvidence,
      next_route: headlessBudgetResult.next_route,
      steps: [headlessStepWithCompletionEvidence],
      next_action: 'start_verification_recovery_explicitly',
    };
    expect(isHeadlessRunAdvanceParams(headlessRunAdvanceParams)).toBe(true);
    expect(isHeadlessRunAdvanceParams({ ...headlessRunAdvanceParams, context_budget: { ...contextBudget, max_prompt_chars: 127 } })).toBe(false);
    expect(isHeadlessRunAdvanceParams({ ...headlessRunAdvanceParams, authorize: false })).toBe(false);
    expect(isHeadlessRunAdvanceParams({ ...headlessRunAdvanceParams, session_id: 'x'.repeat(49) })).toBe(false);
    expect(isHeadlessRunAdvanceParams({ ...headlessRunAdvanceParams, expected_session_sequence: 0 })).toBe(false);
    expect(isHeadlessRunAdvanceParams({ ...headlessRunAdvanceParams, max_steps: 4 })).toBe(false);
    expect(isHeadlessRunAdvanceResult(headlessRunAdvanceResult)).toBe(true);
    expect(isHeadlessRunAdvanceResult({ ...headlessRunAdvanceResult, checkpoint_fingerprint: 'not-a-fingerprint' })).toBe(false);
    expect(isHeadlessRunAdvanceResult({ ...headlessRunAdvanceResult, step_count: 2 })).toBe(false);
    expect(isHeadlessRunAdvanceResult({ ...headlessRunAdvanceResult, terminal_completion_evidence: { ...terminalCompletionEvidence, final_response: 'raw final response' } })).toBe(false);
    expect(isHeadlessRunAdvanceResult({ ...headlessRunAdvanceResult, steps: [{ ...headlessStepWithCompletionEvidence, terminal_completion_evidence: { ...terminalCompletionEvidence, provider_response: 'raw provider response' } }] })).toBe(false);
    expect(isHeadlessRunAdvanceResult({ ...headlessRunAdvanceResult, stdout: 'raw output' })).toBe(false);
    const headlessRunDriveParams = {
      authorize: true,
      session_id: 'm17.session',
      drive_id: 'm17.drive.1',
      expected_start_session_sequence: 1,
      max_advances: 2,
      max_steps_per_advance: 1,
      context_budget: contextBudget,
    };
    const headlessRunDriveResult = {
      status: 'task_executed',
      session_id: 'm17.session',
      drive_id: 'm17.drive.1',
      start_session_sequence: 1,
      end_session_sequence: 2,
      replayed: false,
      max_advances: 2,
      max_steps_per_advance: 1,
      advance_count: 1,
      executed_count: 1,
      replayed_count: 0,
      stop_reason: 'budget_exhausted',
      drive_fingerprint: `sha256:${'f'.repeat(64)}`,
      terminal_completion_evidence: terminalCompletionEvidence,
      start_progress: headlessRunAdvanceResult.start_progress,
      post_progress: headlessRunAdvanceResult.post_progress,
      next_route: headlessBudgetResult.next_route,
      advances: [headlessRunAdvanceResult],
      next_action: 'inspect_progress_overview',
    };
    expect(isHeadlessRunDriveParams(headlessRunDriveParams)).toBe(true);
    expect(isHeadlessRunDriveParams({ ...headlessRunDriveParams, context_budget: { ...contextBudget, max_prompt_chars: 127 } })).toBe(false);
    expect(isHeadlessRunDriveParams({ ...headlessRunDriveParams, authorize: false })).toBe(false);
    expect(isHeadlessRunDriveParams({ ...headlessRunDriveParams, max_advances: 4 })).toBe(false);
    expect(isHeadlessRunDriveResult(headlessRunDriveResult)).toBe(true);
    expect(isHeadlessRunDriveResult({ ...headlessRunDriveResult, drive_fingerprint: 'not-a-fingerprint' })).toBe(false);
    expect(isHeadlessRunDriveResult({ ...headlessRunDriveResult, advance_count: 2 })).toBe(false);
    expect(isHeadlessRunDriveResult({ ...headlessRunDriveResult, terminal_completion_evidence: { ...terminalCompletionEvidence, absolute_path: '/tmp/file' } })).toBe(false);
    expect(isHeadlessRunDriveResult({ ...headlessRunDriveResult, absolute_path: '/tmp/file' })).toBe(false);
    expect(isLedgerEventSummary({
      event_id: 'event_1',
      task_id: 'task_1',
      run_id: 'run_1',
      kind: 'ToolExecutionCompleted',
      timestamp: '2026-06-26T00:00:00Z',
      payload: { output_preview: 'safe', bytes_read: 4, truncated: false },
    })).toBe(true);
    const verifierPayload = {
      tool_id: 'verification.cargo_check',
      status: 'Completed',
      check_id: 'cargo_check',
      verification_status: 'Passed',
      process_launched: true,
      exit_code: 0,
      timed_out: false,
      duration_ms: 12,
      standard_output_bytes: 0,
      standard_error_bytes: 0,
      standard_output_truncated: false,
      standard_error_truncated: false,
      output_redacted: true,
      target_dir_isolated: true,
      cleanup_succeeded: true,
      cargo_dependency_fetch_offline: true,
      os_network_isolated: false,
      compile_time_code_sandboxed: false,
      trusted_workspace_required: true,
      process_tree_timeout_supported: true,
      process_tree_kill_attempted: false,
      process_tree_kill_succeeded: false,
      process_tree_kill_reason: 'not_timed_out',
    };
    expect(isLedgerEventSummary({
      event_id: 'event_2',
      task_id: 'task_1',
      run_id: 'run_1',
      kind: 'ToolExecutionCompleted',
      timestamp: '2026-06-26T00:00:00Z',
      payload: verifierPayload,
    })).toBe(true);
    const cargoTestPayload = {
      ...verifierPayload,
      tool_id: 'verification.cargo_test',
      check_id: 'cargo_test',
      test_code_executed: true,
    };
    expect(isLedgerEventSummary({
      event_id: 'event_test',
      task_id: 'task_1',
      run_id: 'run_1',
      kind: 'ToolExecutionCompleted',
      timestamp: '2026-06-26T00:00:00Z',
      payload: cargoTestPayload,
    })).toBe(true);
    expect(isLedgerEventSummary({
      event_id: 'event_test_raw',
      task_id: 'task_1',
      run_id: 'run_1',
      kind: 'ToolExecutionCompleted',
      timestamp: '2026-06-26T00:00:00Z',
      payload: { ...cargoTestPayload, stdout: 'raw test output' },
    })).toBe(false);
    expect(isLedgerEventSummary({
      event_id: 'event_3',
      task_id: 'task_1',
      run_id: 'run_1',
      kind: 'ToolExecutionCompleted',
      timestamp: '2026-06-26T00:00:00Z',
      payload: { ...verifierPayload, network_disabled: true },
    })).toBe(false);
    expect(isLedgerEventSummary({
      event_id: 'event_4',
      task_id: 'task_1',
      run_id: 'run_1',
      kind: 'ToolExecutionCompleted',
      timestamp: '2026-06-26T00:00:00Z',
      payload: { ...verifierPayload, command: 'cargo check' },
    })).toBe(false);
    expect(isLedgerEventSummary({
      event_id: 'event_5',
      task_id: 'task_1',
      run_id: 'run_1',
      kind: 'ToolExecutionCompleted',
      timestamp: '2026-06-26T00:00:00Z',
      payload: { ...verifierPayload, process_tree_kill_attempted: 'false' },
    })).toBe(false);
  });

  it('validates codebase index build results and rejects raw or unsafe fields', () => {
    const snapshot = {
      index_id: 'idx_abcdef1234567890',
      root: '.',
      workspace_fingerprint: `sha256:${'a'.repeat(64)}`,
      snapshot_fingerprint: `sha256:${'b'.repeat(64)}`,
      built_at: '2026-07-24T00:00:00Z',
      counts: {
        indexed_files: 1,
        walked_directories: 2,
        skipped_protected: 1,
        skipped_ignored: 2,
        skipped_sensitive: 1,
        skipped_symlink: 0,
        skipped_too_large: 0,
        skipped_binary_like: 0,
        skipped_unreadable: 0,
        skipped_unsafe_path: 0,
        skipped_other: 0,
        truncated_entries: 0,
        visited_entries: 2,
        truncated_directories: 0,
        ignore_rule_files_loaded: 2,
        ignore_rule_count: 3,
        sensitive_finding_count: 1,
      },
      limits: {
        max_files: 100,
        max_directories: 100,
        max_path_chars: 512,
        max_file_bytes: 1048576,
        max_visited_entries: 1000,
        max_directory_entries: 100,
      },
      truncated: false,
    };
    const entry = {
      path: 'src/lib.rs',
      file_kind: 'Rust',
      byte_length: 12,
      line_count: 1,
      content_sha256: `sha256:${'c'.repeat(64)}`,
    };
    const result = {
      snapshot,
      persisted: true,
      ledger_event_id: 'event_1',
      ledger_event_kind: 'CodebaseIndexSnapshotBuilt',
      next_action: 'build_bounded_index_query_file_selection',
    };
    const manifest = { snapshot, entries: [entry] };

    expect(isCodebaseIndexBuildResult(result)).toBe(true);
    expect(isCodebaseIndexSnapshotManifest(manifest)).toBe(true);
    expect(isCodebaseIndexBuildResult({ ...result, snapshot: { ...snapshot, root: '/tmp/repo' } })).toBe(false);
    expect(isCodebaseIndexSnapshotManifest({ ...manifest, entries: [{ ...entry, path: '../secret.rs' }] })).toBe(false);
    expect(isCodebaseIndexSnapshotManifest({ ...manifest, entries: [{ ...entry, path: '.brownie/current.json' }] })).toBe(false);
    expect(isCodebaseIndexSnapshotManifest({ ...manifest, entries: [{ ...entry, content: 'raw source' }] })).toBe(false);
    expect(isCodebaseIndexBuildResult({ ...result, absolute_path: '/tmp/repo' })).toBe(false);
    expect(isCodebaseIndexBuildResult({ ...result, snapshot: { ...snapshot, counts: { ...snapshot.counts, raw_ignore_patterns: ['*.pem'] } } })).toBe(false);
    expect(isCodebaseIndexBuildResult({ ...result, next_action: 'build_ignore_aware_sensitive_filtering' })).toBe(false);
    expect(isCodebaseIndexBuildResult({ ...result, next_action: 'use_codebase_index_for_context_planning' })).toBe(false);
    expect(isCodebaseIndexBuildResult({ ...result, snapshot: { ...snapshot, limits: { ...snapshot.limits, max_visited_entries: 200001 } } })).toBe(false);
  });

  it('validates codebase index query results and rejects raw query or unsafe handles', () => {
    const snapshot = {
      index_id: 'idx_abcdef1234567890',
      root: '.',
      workspace_fingerprint: `sha256:${'a'.repeat(64)}`,
      snapshot_fingerprint: `sha256:${'b'.repeat(64)}`,
      built_at: '2026-07-24T00:00:00Z',
      truncated: false,
    };
    const selected = {
      path: 'src/runtime/query.rs',
      file_kind: 'Rust',
      byte_length: 120,
      line_count: 8,
      content_sha256: `sha256:${'c'.repeat(64)}`,
      score: 175,
      match_reasons: ['path_token', 'extension'],
    };
    const result = {
      query_id: 'query_abcdef1234567890',
      selection_id: 'selection_0123456789abcdef',
      query_fingerprint: `sha256:${'d'.repeat(64)}`,
      snapshot,
      matched_entry_count: 1,
      returned_entry_count: 1,
      max_results: 3,
      entries: [selected],
      ledger_event_id: 'event_2',
      ledger_event_kind: 'CodebaseIndexQueryCompleted',
      next_action: 'read_selected_files_with_controlled_workspace_read',
    };

    expect(isCodebaseIndexQueryResult(result)).toBe(true);
    for (const rawField of ['query', 'raw_query', 'content', 'raw_content', 'full_content', 'diff', 'raw_input', 'absolute_path', 'canonical_path', 'file_content', 'stdout', 'stderr', 'env']) {
      expect(isCodebaseIndexQueryResult({ ...result, [rawField]: 'raw' })).toBe(false);
      expect(isCodebaseIndexQueryResult({ ...result, entries: [{ ...selected, [rawField]: 'raw' }] })).toBe(false);
    }
    expect(isCodebaseIndexQueryResult({ ...result, entries: [{ ...selected, path: '../secret.rs' }] })).toBe(false);
    expect(isCodebaseIndexQueryResult({ ...result, entries: [{ ...selected, path: '.brownie/current.json' }] })).toBe(false);
    expect(isCodebaseIndexQueryResult({ ...result, entries: [{ ...selected, path: 'target/debug/build.rs' }] })).toBe(false);
    expect(isCodebaseIndexQueryResult({ ...result, entries: [{ ...selected, file_kind: 'Binary' }] })).toBe(false);
    expect(isCodebaseIndexQueryResult({ ...result, entries: [{ ...selected, content_sha256: 'sha256:not-hex' }] })).toBe(false);
    expect(isCodebaseIndexQueryResult({ ...result, entries: [{ ...selected, score: 0 }] })).toBe(false);
    expect(isCodebaseIndexQueryResult({ ...result, entries: [{ ...selected, match_reasons: [] }] })).toBe(false);
    expect(isCodebaseIndexQueryResult({ ...result, entries: [{ ...selected, match_reasons: ['snippet'] }] })).toBe(false);
    expect(isCodebaseIndexQueryResult({ ...result, ledger_event_kind: 'CodebaseIndexSnapshotBuilt' })).toBe(false);
    expect(isCodebaseIndexQueryResult({ ...result, next_action: 'build_bounded_index_query_file_selection' })).toBe(false);
    expect(isCodebaseIndexQueryResult({ ...result, max_results: 51 })).toBe(false);
    expect(isCodebaseIndexQueryResult({ ...result, returned_entry_count: 2 })).toBe(false);
    expect(isCodebaseIndexQueryResult({ ...result, matched_entry_count: 0 })).toBe(false);
    expect(isCodebaseIndexQueryResult({ ...result, snapshot: { ...snapshot, root: '/tmp/repo' } })).toBe(false);
  });

  it('validates selected index read results with bounded explicit content', () => {
    const snapshot = {
      index_id: 'idx_abcdef1234567890',
      root: '.',
      workspace_fingerprint: `sha256:${'a'.repeat(64)}`,
      snapshot_fingerprint: `sha256:${'b'.repeat(64)}`,
      built_at: '2026-07-24T00:00:00Z',
      truncated: false,
    };
    const result = {
      query_id: 'query_abcdef1234567890',
      selection_id: 'selection_0123456789abcdef',
      query_fingerprint: `sha256:${'c'.repeat(64)}`,
      selection_fingerprint: `sha256:${'d'.repeat(64)}`,
      snapshot,
      path: 'src/runtime/query.rs',
      file_kind: 'Rust',
      content: 'pub fn selected() {}\n',
      truncated: false,
      bytes_read: 21,
      content_sha256: `sha256:${'e'.repeat(64)}`,
      content_hash_verified: true,
      ledger_event_id: 'event_3',
      ledger_event_kind: 'CodebaseIndexSelectionReadCompleted',
      next_action: 'use_selected_file_context_for_prompt_materialization',
    };

    expect(isCodebaseIndexSelectionReadResult(result)).toBe(true);
    for (const rawField of ['query', 'raw_query', 'raw_content', 'full_content', 'diff', 'raw_input', 'absolute_path', 'canonical_path', 'file_content', 'stdout', 'stderr', 'env', 'command']) {
      expect(isCodebaseIndexSelectionReadResult({ ...result, [rawField]: 'raw' })).toBe(false);
    }
    expect(isCodebaseIndexSelectionReadResult({ ...result, path: '../secret.rs' })).toBe(false);
    expect(isCodebaseIndexSelectionReadResult({ ...result, path: '.brownie/current.json' })).toBe(false);
    expect(isCodebaseIndexSelectionReadResult({ ...result, file_kind: 'Binary' })).toBe(false);
    expect(isCodebaseIndexSelectionReadResult({ ...result, truncated: true })).toBe(false);
    expect(isCodebaseIndexSelectionReadResult({ ...result, bytes_read: 65537 })).toBe(false);
    expect(isCodebaseIndexSelectionReadResult({ ...result, content_hash_verified: false })).toBe(false);
    expect(isCodebaseIndexSelectionReadResult({ ...result, content_sha256: 'sha256:not-hex' })).toBe(false);
    expect(isCodebaseIndexSelectionReadResult({ ...result, bytes_read: 20 })).toBe(false);
    expect(isCodebaseIndexSelectionReadResult({ ...result, ledger_event_kind: 'CodebaseIndexQueryCompleted' })).toBe(false);
    expect(isCodebaseIndexSelectionReadResult({ ...result, next_action: 'read_selected_files_with_controlled_workspace_read' })).toBe(false);
    expect(isCodebaseIndexSelectionReadResult({ ...result, unexpected: 'field' })).toBe(false);
    expect(isCodebaseIndexSelectionReadResult({ ...result, content: 'x'.repeat(65537) })).toBe(false);
  });

  it('validates task.run selected index params and bounded prompt-context summaries', () => {
    const selectedContext = {
      query_id: 'query_abcdef1234567890',
      selection_id: 'selection_0123456789abcdef',
      query_fingerprint: `sha256:${'c'.repeat(64)}`,
      selection_fingerprint: `sha256:${'d'.repeat(64)}`,
      snapshot: {
        index_id: 'idx_abcdef1234567890',
        root: '.',
        workspace_fingerprint: `sha256:${'a'.repeat(64)}`,
        snapshot_fingerprint: `sha256:${'b'.repeat(64)}`,
        built_at: '2026-07-24T00:00:00Z',
        truncated: false,
      },
      path: 'src/runtime/query.rs',
      file_kind: 'Rust',
      content: 'pub fn selected() {}\n',
      truncated: false,
      bytes_read: 21,
      content_sha256: `sha256:${'e'.repeat(64)}`,
      content_hash_verified: true,
      ledger_event_id: 'event_3',
      ledger_event_kind: 'CodebaseIndexSelectionReadCompleted',
      next_action: 'use_selected_file_context_for_prompt_materialization',
    };
    const summary = {
      prompt_context_id: 'ctx_0123456789abcdef',
      source_event_id: 'event_3',
      source_event_kind: 'CodebaseIndexSelectionReadCompleted',
      query_id: selectedContext.query_id,
      selection_id: selectedContext.selection_id,
      query_fingerprint: selectedContext.query_fingerprint,
      selection_fingerprint: selectedContext.selection_fingerprint,
      index_id: selectedContext.snapshot.index_id,
      workspace_fingerprint: selectedContext.snapshot.workspace_fingerprint,
      snapshot_fingerprint: selectedContext.snapshot.snapshot_fingerprint,
      read_path_fingerprint: `sha256:${'f'.repeat(64)}`,
      file_kind: 'Rust',
      bytes_read: 21,
      content_char_count: 21,
      materialized_content_char_count: 12,
      content_truncated_for_prompt: true,
      content_sha256: selectedContext.content_sha256,
      prompt_preview_redacted: true,
      next_action: 'continue_task_execution_with_materialized_context',
    };

    expect(isTaskRunParams({ task_id: 'task_1' })).toBe(true);
    expect(isTaskRunParams({ task_id: 'task_1', selected_index_context: selectedContext })).toBe(true);
    expect(isTaskRunParams({ task_id: 'task_1', context_budget: { max_prompt_chars: 4096, max_ledger_events: 4, max_selected_index_chars: 1024 } })).toBe(true);
    expect(isTaskRunParams({ task_id: 'task_1', context_budget: { max_prompt_chars: 127, max_ledger_events: 4, max_selected_index_chars: 1024 } })).toBe(false);
    expect(isTaskRunParams({ task_id: 'task_1', selected_index_context: { ...selectedContext, content: 'changed' } })).toBe(false);
    expect(isTaskRunParams({ task_id: 'task_1', selected_index_context: selectedContext, raw_input: 'nope' })).toBe(false);
    expect(isTaskRunSelectedIndexPromptContextSummary(summary)).toBe(true);
    expect(isTaskRunResult({
      task_id: 'task_1',
      run_id: 'run_1',
      status: 'Completed',
      agent_loop: { final_state: 'Completed', completion_summary: 'done' },
      completion_evidence: {
        final_state: 'Completed',
        task_status: 'Completed',
        completion_result_fingerprint: `sha256:${'a'.repeat(64)}`,
        completion_summary_preview: 'done',
        completion_summary_chars: 4,
        completion_summary_truncated: false,
        final_response_present: true,
        final_response_chars: 12,
        replayed: false,
      },
      selected_index_prompt_context: summary,
      context_budget: {
        requested: true,
        max_prompt_chars: 4096,
        max_ledger_events: 4,
        max_selected_index_chars: 1024,
        total_events: 9,
        included_events: 4,
        omitted_events: 5,
        selected_index_context_present: true,
        selected_index_content_chars: 21,
        selected_index_materialized_chars: 12,
        selected_index_truncated: true,
        protected_context_chars: 512,
        prompt_chars: 2048,
        prompt_within_budget: true,
      },
    })).toBe(true);
    expect(isTaskRunResult({
      task_id: 'task_1',
      run_id: 'run_1',
      status: 'Completed',
      agent_loop: { final_state: 'Completed', completion_summary: 'done' },
      completion_evidence: {
        final_state: 'Completed',
        task_status: 'Completed',
        completion_result_fingerprint: 'not-a-fingerprint',
        completion_summary_preview: 'done',
        completion_summary_chars: 4,
        completion_summary_truncated: false,
        final_response_present: true,
        final_response_chars: 12,
        replayed: false,
      },
    })).toBe(false);
    expect(isTaskRunContextBudgetSummary({
      requested: true,
      max_prompt_chars: 4096,
      max_ledger_events: 4,
      max_selected_index_chars: 1024,
      total_events: 9,
      included_events: 4,
      omitted_events: 5,
      selected_index_context_present: true,
      selected_index_content_chars: 21,
      selected_index_materialized_chars: 22,
      selected_index_truncated: true,
      protected_context_chars: 512,
      prompt_chars: 2048,
      prompt_within_budget: true,
    })).toBe(false);
    expect(isTaskRunSelectedIndexPromptContextSummary({ ...summary, content: selectedContext.content })).toBe(false);
    expect(isTaskRunSelectedIndexPromptContextSummary({ ...summary, path: selectedContext.path })).toBe(false);
    expect(isTaskRunSelectedIndexPromptContextSummary({ ...summary, prompt_preview_redacted: false })).toBe(false);
    expect(isTaskRunSelectedIndexPromptContextSummary({ ...summary, next_action: 'use_selected_file_context_for_prompt_materialization' })).toBe(false);
    expect(isTaskRunSelectedIndexPromptContextSummary({ ...summary, bytes_read: 65537 })).toBe(false);
  });

  it('validates recovery-cycle child provenance invariants', () => {
    expect(isRecoveryCycleChildProvenance(recoveryCycleChildProvenance)).toBe(true);
    expect(isTaskRecord({ ...taskRecord, recovery_cycle_provenance: recoveryCycleChildProvenance })).toBe(true);
    expect(isRecoveryCycleChildProvenance({ ...recoveryCycleChildProvenance, parent_join_recovery_cycle_depth: 1.5 })).toBe(false);
    expect(isRecoveryCycleChildProvenance({ ...recoveryCycleChildProvenance, parent_join_recovery_cycle_depth: -1 })).toBe(false);
    expect(isRecoveryCycleChildProvenance({ ...recoveryCycleChildProvenance, parent_join_admission_id: '' })).toBe(false);
    expect(isRecoveryCycleChildProvenance({ ...recoveryCycleChildProvenance, parent_join_child_completion_fingerprint: 'sha256:not-hex' })).toBe(false);
    expect(isRecoveryCycleChildProvenance({
      ...recoveryCycleChildProvenance,
      parent_join_child_completion_child_count: 3,
      parent_join_terminal_failed_child_count: 3,
      parent_join_terminal_completed_child_count: 1,
    })).toBe(false);
    expect(isRecoveryCycleChildProvenance({ ...recoveryCycleChildProvenance, parent_join_recovery_cycle: true, parent_join_recovery_cycle_depth: 0 })).toBe(false);
    expect(isRecoveryCycleChildProvenance({ ...recoveryCycleChildProvenance, parent_join_recovery_cycle: false, parent_join_recovery_cycle_depth: 1 })).toBe(false);
    expect(isRecoveryCycleChildProvenance({ ...recoveryCycleChildProvenance, content: 'raw child prompt' })).toBe(false);
    expect(isTaskRecord({ ...taskRecord, recovery_cycle_provenance: { ...recoveryCycleChildProvenance, parent_join_terminal_completed_child_count: 5 } })).toBe(false);
  });

  it('validates recovery-cycle budget exhaustion outcomes', () => {
    expect(isRecoveryCycleBudgetOutcome(recoveryCycleBudgetOutcome)).toBe(true);
    expect(isTaskRunResult({ task_id: 'task_1', run_id: 'run_1', status: 'Completed', agent_loop: { final_state: 'Completed', completion_summary: 'done' }, recovery_cycle_budget_outcome: recoveryCycleBudgetOutcome })).toBe(true);
    expect(isRecoveryCycleBudgetOutcome({ ...recoveryCycleBudgetOutcome, recovery_cycle_budget_status: 'Accepted' })).toBe(false);
    expect(isRecoveryCycleBudgetOutcome({ ...recoveryCycleBudgetOutcome, parent_join_admission_id: '' })).toBe(false);
    expect(isRecoveryCycleBudgetOutcome({ ...recoveryCycleBudgetOutcome, parent_join_recovery_cycle_depth: 0 })).toBe(false);
    expect(isRecoveryCycleBudgetOutcome({ ...recoveryCycleBudgetOutcome, blocked_candidate_count: 0 })).toBe(false);
    expect(isRecoveryCycleBudgetOutcome({ ...recoveryCycleBudgetOutcome, child_materialization_enabled: true })).toBe(false);
    expect(isRecoveryCycleBudgetOutcome({ ...recoveryCycleBudgetOutcome, child_running_enabled: true })).toBe(false);
    expect(isRecoveryCycleBudgetOutcome({ ...recoveryCycleBudgetOutcome, stdout: 'raw' })).toBe(false);
  });

  it('validates parent task.run child-orchestration outcomes', () => {
    expect(isTaskRunChildOrchestrationOutcome(childOrchestrationOutcome)).toBe(true);
    expect(isTaskRunResult({ task_id: 'task_1', run_id: 'run_1', status: 'Completed', agent_loop: { final_state: 'Completed', completion_summary: 'done' }, child_orchestration_outcome: childOrchestrationOutcome })).toBe(true);
    expect(isTaskRunChildOrchestrationOutcome({ ...childOrchestrationOutcome, materialized_child_count: 2 })).toBe(false);
    expect(isTaskRunChildOrchestrationOutcome({ ...childOrchestrationOutcome, queued_child_task_ids: ['task_missing'] })).toBe(false);
    expect(isTaskRunChildOrchestrationOutcome({ ...childOrchestrationOutcome, queued_child_count: 0 })).toBe(false);
    expect(isTaskRunChildOrchestrationOutcome({ ...childOrchestrationOutcome, child_running_enabled: true })).toBe(false);
    expect(isTaskRunChildOrchestrationOutcome({ ...childOrchestrationOutcome, next_action: 'scheduler_handoff' })).toBe(false);
    expect(isTaskRunChildOrchestrationOutcome({ ...childOrchestrationOutcome, request_reason: 'raw' })).toBe(false);
    expect(isTaskRunChildOrchestrationOutcome({ ...childOrchestrationOutcome, stdout: 'raw' })).toBe(false);
  });

  it('validates controlled child parent-join readiness outcomes', () => {
    expect(isTaskRunParentJoinReadinessOutcome(parentJoinReadinessOutcome)).toBe(true);
    expect(isTaskRunParentJoinReadinessOutcome(pendingSiblingParentJoinReadinessOutcome)).toBe(true);
    expect(isTaskRunParentJoinReadinessOutcome(nonRunnableSiblingParentJoinReadinessOutcome)).toBe(true);
    expect(isRunInspectParentJoinReadinessSummary(parentInspectJoinReadinessSummary)).toBe(true);
    expect(isRunInspectParentJoinReadinessSummary(pendingSiblingParentInspectJoinReadinessSummary)).toBe(true);
    expect(isRunInspectParentJoinReadinessSummary(nonRunnableSiblingParentInspectJoinReadinessSummary)).toBe(true);
    expect(isChildInspectParentJoinReadinessSummary(childInspectParentJoinReadinessSummary)).toBe(true);
    expect(isChildInspectParentJoinReadinessSummary(pendingSiblingChildInspectParentJoinReadinessSummary)).toBe(true);
    expect(isChildInspectParentJoinReadinessSummary(nonRunnableSiblingChildInspectParentJoinReadinessSummary)).toBe(true);
    expect(isChildInspectParentJoinReadinessSummary({ ...pendingSiblingChildInspectParentJoinReadinessSummary, inspected_child_status: 'Queued' })).toBe(true);
    expect(isChildInspectConsumedParentJoinRecoverySummary(childInspectConsumedParentJoinRecoverySummary)).toBe(true);
    expect(isChildInspectConsumedParentJoinRecoverySummary({ ...childInspectConsumedParentJoinRecoverySummary, continuation_runnable_child_count: 0, continuation_runnable_child_task_ids: [], continuation_non_runnable_child_count: 1, continuation_non_runnable_child_task_ids: ['task_child_2'], next_action: 'inspect_non_runnable_continuation_child_tasks' })).toBe(true);
    expect(isChildInspectConsumedParentJoinRecoverySummary({ ...childInspectConsumedParentJoinRecoverySummary, continuation_runnable_child_count: 0, continuation_runnable_child_task_ids: [], continuation_controlled_child_count: 0, next_action: 'inspect_parent_task' })).toBe(true);
    expect(isRunInspectConsumedParentJoinRecoverySummary(parentInspectConsumedParentJoinRecoverySummary)).toBe(true);
    expect(isRunInspectConsumedParentJoinRecoverySummary({ ...parentInspectConsumedParentJoinRecoverySummary, continuation_runnable_child_count: 0, continuation_runnable_child_task_ids: [], continuation_non_runnable_child_count: 1, continuation_non_runnable_child_task_ids: ['task_child_2'], next_action: 'inspect_non_runnable_continuation_child_tasks' })).toBe(true);
    expect(isRunInspectConsumedParentJoinRecoverySummary({ ...parentInspectConsumedParentJoinRecoverySummary, continuation_runnable_child_count: 0, continuation_runnable_child_task_ids: [], continuation_controlled_child_count: 0, next_action: 'inspect_parent_task' })).toBe(true);
    expect(isTaskInspectResult({ task: taskRecord, run: baseRunInspectSummary, parent_join_readiness_summary: pendingSiblingChildInspectParentJoinReadinessSummary })).toBe(true);
    expect(isTaskInspectResult({ task: taskRecord, run: baseRunInspectSummary, consumed_parent_join_recovery_summary: childInspectConsumedParentJoinRecoverySummary })).toBe(true);
    expect(isTaskInspectResult({ task: taskRecord, run: { ...baseRunInspectSummary, consumed_parent_join_recovery_summary: parentInspectConsumedParentJoinRecoverySummary } })).toBe(true);
    expect(isTaskRunParentJoinReadinessOutcome({ ...parentJoinReadinessOutcome, child_terminal_status: 'Failed' })).toBe(true);
    expect(isTaskRunResult({ task_id: 'task_child_1', run_id: 'run_child_1', status: 'Completed', agent_loop: { final_state: 'Completed', completion_summary: 'done' }, parent_join_readiness_outcome: parentJoinReadinessOutcome })).toBe(true);
    expect(isTaskRunParentJoinReadinessOutcome({ ...parentJoinReadinessOutcome, parent_task_id: '' })).toBe(false);
    expect(isTaskRunParentJoinReadinessOutcome({ ...parentJoinReadinessOutcome, child_terminal_status: 'Queued' })).toBe(false);
    expect(isTaskRunParentJoinReadinessOutcome({ ...parentJoinReadinessOutcome, parent_join_ready: false })).toBe(false);
    expect(isTaskRunParentJoinReadinessOutcome({ ...pendingSiblingParentJoinReadinessOutcome, parent_join_ready: true })).toBe(false);
    expect(isTaskRunParentJoinReadinessOutcome({ ...pendingSiblingParentJoinReadinessOutcome, pending_controlled_child_count: 2 })).toBe(false);
    expect(isTaskRunParentJoinReadinessOutcome({ ...pendingSiblingParentJoinReadinessOutcome, pending_controlled_child_task_ids: ['task_child_1'] })).toBe(false);
    expect(isTaskRunParentJoinReadinessOutcome({ ...pendingSiblingParentJoinReadinessOutcome, next_action: 'run_parent_task_explicitly' })).toBe(false);
    expect(isTaskRunParentJoinReadinessOutcome({ ...nonRunnableSiblingParentJoinReadinessOutcome, non_runnable_controlled_child_count: 2 })).toBe(false);
    expect(isTaskRunParentJoinReadinessOutcome({ ...nonRunnableSiblingParentJoinReadinessOutcome, non_runnable_controlled_child_task_ids: ['task_child_1'] })).toBe(false);
    expect(isTaskRunParentJoinReadinessOutcome({ ...nonRunnableSiblingParentJoinReadinessOutcome, next_action: 'run_remaining_child_tasks_explicitly' })).toBe(false);
    expect(isTaskRunParentJoinReadinessOutcome({ ...parentJoinReadinessOutcome, parent_running_enabled: true })).toBe(false);
    expect(isTaskRunParentJoinReadinessOutcome({ ...parentJoinReadinessOutcome, next_action: 'auto_run_parent' })).toBe(false);
    expect(isTaskRunParentJoinReadinessOutcome({ ...parentJoinReadinessOutcome, stdout: 'raw' })).toBe(false);
    expect(isRunInspectParentJoinReadinessSummary({ ...parentInspectJoinReadinessSummary, terminal_controlled_child_count: 0 })).toBe(false);
    expect(isRunInspectParentJoinReadinessSummary({ ...pendingSiblingParentInspectJoinReadinessSummary, pending_controlled_child_count: 2 })).toBe(false);
    expect(isRunInspectParentJoinReadinessSummary({ ...pendingSiblingParentInspectJoinReadinessSummary, parent_join_ready: true })).toBe(false);
    expect(isRunInspectParentJoinReadinessSummary({ ...nonRunnableSiblingParentInspectJoinReadinessSummary, non_runnable_controlled_child_count: 2 })).toBe(false);
    expect(isRunInspectParentJoinReadinessSummary({ ...nonRunnableSiblingParentInspectJoinReadinessSummary, non_runnable_controlled_child_task_ids: ['task_child_2', 'task_child_2'] })).toBe(false);
    expect(isRunInspectParentJoinReadinessSummary({ ...nonRunnableSiblingParentInspectJoinReadinessSummary, next_action: 'run_remaining_child_tasks_explicitly' })).toBe(false);
    expect(isChildInspectParentJoinReadinessSummary({ ...childInspectParentJoinReadinessSummary, inspected_child_task_id: '' })).toBe(false);
    expect(isChildInspectParentJoinReadinessSummary({ ...childInspectParentJoinReadinessSummary, inspected_child_status: 'Nope' })).toBe(false);
    expect(isChildInspectParentJoinReadinessSummary({ ...childInspectParentJoinReadinessSummary, parent_join_ready: false })).toBe(false);
    expect(isChildInspectParentJoinReadinessSummary({ ...pendingSiblingChildInspectParentJoinReadinessSummary, next_action: 'run_parent_task_explicitly' })).toBe(false);
    expect(isChildInspectParentJoinReadinessSummary({ ...nonRunnableSiblingChildInspectParentJoinReadinessSummary, next_action: 'run_remaining_child_tasks_explicitly' })).toBe(false);
    expect(isChildInspectParentJoinReadinessSummary({ ...nonRunnableSiblingChildInspectParentJoinReadinessSummary, non_runnable_controlled_child_task_ids: ['task_child_2', 'task_child_2'] })).toBe(false);
    expect(isTaskInspectResult({ task: taskRecord, run: baseRunInspectSummary, parent_join_readiness_summary: { ...pendingSiblingChildInspectParentJoinReadinessSummary, raw_failure_payload: 'raw' } })).toBe(false);
    expect(isChildInspectConsumedParentJoinRecoverySummary({ ...childInspectConsumedParentJoinRecoverySummary, parent_join_consumed: false })).toBe(false);
    expect(isChildInspectConsumedParentJoinRecoverySummary({ ...childInspectConsumedParentJoinRecoverySummary, next_action: 'run_parent_task_explicitly' })).toBe(false);
    expect(isChildInspectConsumedParentJoinRecoverySummary({ ...childInspectConsumedParentJoinRecoverySummary, continuation_runnable_child_count: 2 })).toBe(false);
    expect(isChildInspectConsumedParentJoinRecoverySummary({ ...childInspectConsumedParentJoinRecoverySummary, continuation_runnable_child_task_ids: ['task_child_2', 'task_child_2'] })).toBe(false);
    expect(isTaskInspectResult({ task: taskRecord, run: baseRunInspectSummary, consumed_parent_join_recovery_summary: { ...childInspectConsumedParentJoinRecoverySummary, raw_failure_payload: 'raw' } })).toBe(false);
    expect(isRunInspectConsumedParentJoinRecoverySummary({ ...parentInspectConsumedParentJoinRecoverySummary, parent_join_consumed: false })).toBe(false);
    expect(isRunInspectConsumedParentJoinRecoverySummary({ ...parentInspectConsumedParentJoinRecoverySummary, next_action: 'run_parent_task_explicitly' })).toBe(false);
    expect(isRunInspectConsumedParentJoinRecoverySummary({ ...parentInspectConsumedParentJoinRecoverySummary, continuation_runnable_child_count: 2 })).toBe(false);
    expect(isRunInspectConsumedParentJoinRecoverySummary({ ...parentInspectConsumedParentJoinRecoverySummary, continuation_runnable_child_task_ids: ['task_child_2', 'task_child_2'] })).toBe(false);
    expect(isRunInspectSummary({ ...baseRunInspectSummary, consumed_parent_join_recovery_summary: { ...parentInspectConsumedParentJoinRecoverySummary, raw_failure_payload: 'raw' } })).toBe(false);
    expect(isRunInspectParentJoinReadinessSummary({ ...parentInspectJoinReadinessSummary, parent_running_enabled: true })).toBe(false);
    expect(isRunInspectParentJoinReadinessSummary({ ...parentInspectJoinReadinessSummary, raw_failure_payload: 'raw' })).toBe(false);
    expect(isTaskRunResult({ task_id: 'task_child_1', run_id: 'run_child_1', status: 'Completed', agent_loop: { final_state: 'Completed', completion_summary: 'done' }, parent_join_readiness_outcome: { ...parentJoinReadinessOutcome, raw_failure_payload: 'raw' } })).toBe(false);
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
    const applyPlan = { proposal_id: 'proposal_1', plan_id: 'plan_1', status: 'Ready', checklist: [{ name: 'apply_execution_available', status: 'Pass', reason: 'Patch apply is available through proposal.apply.' }] };
    expect(isProposalApproveResult({ proposal: { ...result.proposals[0], approval_status: 'Approved', approved_at: '2026-06-30T00:00:00Z', latest_apply_plan: applyPlan }, apply_plan: applyPlan })).toBe(true);
    const snapshot = { proposal_id: 'proposal_1', snapshot_id: 'snapshot_1', path: 'README.md', canonical_path_hash: 'sha256:abc', file_exists: true, file_kind: 'File', file_size_bytes: 3, file_modified_unix_ms: 1780000000000, file_sha256: 'sha256:def', captured_at: '2026-06-30T00:00:00Z', stale: false, stale_reason: null };
    expect(isProposalPreflightResult({ proposal: { ...result.proposals[0], approval_status: 'Approved', approved_at: '2026-06-30T00:00:00Z', latest_snapshot: snapshot, latest_apply_plan: applyPlan }, snapshot, apply_plan: applyPlan })).toBe(true);
    expect(isProposalPreflightResult({ proposal: result.proposals[0], snapshot: { ...snapshot, canonical_path: '/tmp/README.md' }, apply_plan: applyPlan })).toBe(false);
    expect(isProposalPreflightResult({ proposal: result.proposals[0], snapshot: { ...snapshot, raw_input: {} }, apply_plan: applyPlan })).toBe(false);
    const report = { proposal_id: 'proposal_1', report_id: 'report_1', readiness_status: 'Ready', readiness_reason: null, generated_at: '2026-07-01T00:00:00Z', checklist: [{ name: 'apply_execution_supported', status: 'Pass', reason: 'Patch apply execution is available through proposal.apply.' }], summary: 'Ready for final human review. Controlled apply execution is available through proposal.apply.' };
    expect(isProposalReadinessResult({ proposal: { ...result.proposals[0], approval_status: 'Approved', approved_at: '2026-06-30T00:00:00Z', latest_snapshot: snapshot, latest_apply_plan: applyPlan }, report })).toBe(true);
    expect(isProposalReadinessResult({ proposal: result.proposals[0], report: { ...report, file_content: 'secret' } })).toBe(false);
    expect(isProposalReadinessResult({ proposal: result.proposals[0], report: { ...report, checklist: [{ ...report.checklist[0], diff: 'raw' }] } })).toBe(false);
    const capability = { proposal_id: 'proposal_1', capability_id: 'apply_capability_1', apply_supported: true, apply_enabled: true, mode: 'controlled_apply', reason: 'proposal.apply can execute after explicit one-time authorization and expected target hash verification.', required_gates: ['proposal_valid', 'runtime_apply_supported'], can_apply_now: true, checked_at: '2026-07-01T00:00:00Z', check_count: 2, failed_checks: [], blocked_checks: [], checklist: [{ name: 'apply_execution_supported', status: 'Pass', reason: 'Patch apply execution is available through proposal.apply.' }, { name: 'no_raw_content_exposed', status: 'Pass', reason: null }] };
    expect(isProposalApplyCapabilityResult({ proposal: result.proposals[0], capability })).toBe(true);
    expect(isProposalApplyCapabilityResult({ proposal: result.proposals[0], capability: { ...capability, apply_enabled: 'true' } })).toBe(false);
    expect(isProposalApplyCapabilityResult({ proposal: result.proposals[0], capability: { ...capability, raw_input: { patch: 'raw' } } })).toBe(false);
    expect(isProposalApplyCapabilityResult({ proposal: result.proposals[0], capability: { ...capability, checklist: [{ ...capability.checklist[0], diff: 'raw' }] } })).toBe(false);
    const applyResult = { proposal_id: 'proposal_1', apply_id: 'apply_1', apply_status: 'Applied', apply_reason: 'Patch applied and post-write hash verification succeeded.', authorization_id: 'apply_auth_1', authorization_consumed: true, applied: true, operation: 'replace_file', atomic_replacement_completed: true, atomic_create_completed: false, atomic_delete_completed: false, path: 'README.md', expected_target_sha256: 'sha256:def', expected_target_absent: null, pre_write_target_sha256: 'sha256:def', pre_write_target_exists: true, post_write_sha256: 'sha256:123', post_delete_target_exists: null, content_chars: 3, content_bytes: 3, checked_at: '2026-07-01T00:00:00Z', applied_at: '2026-07-01T00:00:01Z', temp_file_cleaned: true, check_count: 2, failed_checks: [], blocked_checks: [], checklist: [{ name: 'expected_target_hash_matches', status: 'Pass', reason: null }, { name: 'atomic_replacement_completed', status: 'Pass', reason: null }] };
    expect(isProposalApplyResult({ proposal: result.proposals[0], apply_result: applyResult })).toBe(true);
    expect(isProposalApplyResult({ proposal: result.proposals[0], apply_result: { ...applyResult, content: 'new' } })).toBe(false);
    expect(isProposalApplyResult({ proposal: result.proposals[0], apply_result: { ...applyResult, checklist: [{ ...applyResult.checklist[0], patch: 'raw' }] } })).toBe(false);
    const transactionRecoverySource = { source_run_id: 'run_1', source_apply_id: 'apply_source_1', source_transaction_id: 'apply_tx_source_1', source_transaction_fingerprint: 'sha256:abc', source_transaction_status: 'PartialFailed', source_item_count: 2, source_applied_item_count: 1, source_recovery_item_count: 1 };
    const transactionRecoveryResult = { ...applyResult, operation: 'replace_file_transaction_recovery', path: '[transaction_recovery]', transaction_id: 'apply_tx_recovery_1', transaction_status: 'Applied', transaction_recovery_status: 'Applied', transaction_recovery_source: transactionRecoverySource, transaction_items: [{ proposal_id: 'proposal_1', apply_status: 'Applied', apply_reason: 'File recovered and post-write SHA-256 verified.', operation: 'replace_file', path: 'README.md', expected_target_sha256: 'sha256:def', expected_target_absent: null, pre_write_target_sha256: 'sha256:def', pre_write_target_exists: true, post_write_sha256: 'sha256:123', content_chars: 3, content_bytes: 3, atomic_replacement_completed: true, atomic_create_completed: false, applied: true, temp_file_cleaned: true }] };
    expect(isProposalApplyResult({ proposal: result.proposals[0], apply_result: transactionRecoveryResult })).toBe(true);
    expect(isProposalApplyResult({ proposal: result.proposals[0], apply_result: { ...transactionRecoveryResult, transaction_recovery_source: { ...transactionRecoverySource, source_item_count: -1 } } })).toBe(false);
    expect(isProposalApplyResult({ proposal: result.proposals[0], apply_result: { ...transactionRecoveryResult, transaction_recovery_source: { ...transactionRecoverySource, raw_input: 'secret' } } })).toBe(false);
    const dryRun = { proposal_id: 'proposal_1', dry_run_id: 'apply_dry_run_1', dry_run_status: 'Completed', dry_run_reason: 'Dry run completed without applying a patch or changing workspace files.', checked_at: '2026-07-01T00:00:00Z', required_gates: ['proposal_valid', 'readiness_ready', 'runtime_apply_supported'], check_count: 2, failed_checks: [], blocked_checks: [], no_patch_applied: true, apply_executed: false, workspace_files_changed: false, checklist: [{ name: 'apply_execution_supported', status: 'Pass', reason: 'Patch apply execution is available through proposal.apply; dry-run does not invoke it.' }, { name: 'workspace_files_unchanged', status: 'Pass', reason: 'Dry-run inspection does not write workspace files.' }] };
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
    const reviewBundle = { proposal_id: 'proposal_1', review_status: 'Complete', review_reason: 'All proposal review signals are available for final human review.', latest_readiness: reviewSignal, latest_apply_capability: { status: 'true', reason: 'proposal.apply can execute after explicit one-time authorization and expected target hash verification.', generated_at: '2026-07-01T00:00:00Z', source_id: 'apply_capability_1' }, latest_apply_dry_run: { status: 'Completed', reason: 'Dry run completed without applying a patch or changing workspace files.', generated_at: '2026-07-01T00:00:00Z', source_id: 'apply_dry_run_1' }, audit_event_count: 1, latest_audit_event: auditEntry, required_next_actions: [], generated_at: '2026-07-01T00:01:00Z' };
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
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryEntry = { report_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_1', report_status: 'Complete', history_status: 'Complete', digest_status: 'Complete', digest_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:14:00Z' };
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistory = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report is complete; patch apply remains unauthorized.', report_count: 1, latest_report: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryEntry, entries: [reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryEntry], apply_authorized: false, generated_at: '2026-07-01T00:15:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistory })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistory, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistory, entries: [{ ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryEntry, raw_input: 'raw' }] } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistory, report_count: 2 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigest = { run_id: 'run_1', digest_status: 'Complete', digest_reason: 'Diagnostics digest report verdict report history digest history report history digest is complete; patch apply remains unauthorized.', history_status: 'Complete', report_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:16:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigest })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigest, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigest, raw_input: 'raw' } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigest, required_next_action_count: 1 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntry = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:16:00Z' };
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistory = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest is complete; patch apply remains unauthorized.', digest_count: 1, latest_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, entries: [reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntry], apply_authorized: false, generated_at: '2026-07-01T00:17:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistory })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistory, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistory, entries: [{ ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, diff: 'raw' }] } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistory, digest_count: 2 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReport = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Diagnostics digest report verdict report history digest history report history digest history report is complete; patch apply remains unauthorized.', history_status: 'Complete', digest_status: 'Complete', digest_count: 1, latest_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:18:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReport })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReport, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReport, latest_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, raw_input: 'raw' } } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReport, required_next_action_count: 1 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry = { report_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_1', report_status: 'Complete', history_status: 'Complete', digest_status: 'Complete', digest_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:18:00Z' };
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report is complete; patch apply remains unauthorized.', report_count: 1, latest_report: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry, entries: [reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry], apply_authorized: false, generated_at: '2026-07-01T00:19:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory, entries: [{ ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry, raw_input: 'raw' }] } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory, report_count: 2 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest = { run_id: 'run_1', digest_status: 'Complete', digest_reason: 'Diagnostics digest report verdict report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:20:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest, raw_input: 'raw' } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest, required_next_action_count: 1 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:20:00Z' };
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', digest_count: 1, latest_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, entries: [reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry], apply_authorized: false, generated_at: '2026-07-01T00:21:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory, entries: [{ ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, raw_input: 'raw' }] } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory, digest_count: 2 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Diagnostics digest report verdict report history digest history report history digest history report history digest history report is complete; patch apply remains unauthorized.', history_status: 'Complete', digest_status: 'Complete', digest_count: 1, latest_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:22:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport, latest_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, raw_input: 'raw' } } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport, required_next_action_count: 1 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry = { report_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_1', report_status: 'Complete', history_status: 'Complete', digest_status: 'Complete', digest_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:22:00Z' };
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report history digest history report is complete; patch apply remains unauthorized.', report_count: 1, latest_report: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry, entries: [reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry], apply_authorized: false, generated_at: '2026-07-01T00:23:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory, entries: [{ ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry, raw_input: 'raw' }] } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory, report_count: 2 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest = { run_id: 'run_1', digest_status: 'Complete', digest_reason: 'Diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:24:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest, raw_input: 'raw' } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest, required_next_action_count: 1 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:24:00Z' };
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', digest_count: 1, latest_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, entries: [reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry], apply_authorized: false, generated_at: '2026-07-01T00:25:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory, entries: [{ ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, raw_input: 'raw' }] } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory, digest_count: 2 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report is complete; patch apply remains unauthorized.', history_status: 'Complete', digest_status: 'Complete', digest_count: 1, latest_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:26:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport, latest_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, raw_input: 'raw' } } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport, required_next_action_count: 1 } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport, latest_digest: null, digest_count: 0, proposal_count: 0, complete_count: 0, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0 } })).toBe(true);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry = { report_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_1', report_status: 'Complete', history_status: 'Complete', digest_status: 'Complete', digest_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:26:00Z' };
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report is complete; patch apply remains unauthorized.', report_count: 1, latest_report: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry, entries: [reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry], apply_authorized: false, generated_at: '2026-07-01T00:27:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory, entries: [{ ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry, raw_input: 'raw' }] } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory, report_count: 2 } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory, report_count: 0, latest_report: null, entries: [] } })).toBe(true);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest = { run_id: 'run_1', digest_status: 'Complete', digest_reason: 'Diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:28:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest, raw_input: 'raw' } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest, required_next_action_count: 1 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:28:00Z' };
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', digest_count: 1, latest_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, entries: [reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry], apply_authorized: false, generated_at: '2026-07-01T00:29:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory, entries: [{ ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, raw_input: 'raw' }] } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory, digest_count: 2 } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory, digest_count: 0, latest_digest: null, entries: [] } })).toBe(true);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report is complete; patch apply remains unauthorized.', history_status: 'Complete', digest_count: 1, latest_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:30:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport, latest_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, raw_input: 'raw' } } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport, required_next_action_count: 1 } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport, digest_count: 0, latest_digest: null, proposal_count: 0, complete_count: 0, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0 } })).toBe(true);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry = { report_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_1', report_status: 'Complete', history_status: 'Complete', digest_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:30:00Z' };
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report is complete; patch apply remains unauthorized.', report_count: 1, latest_report: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry, entries: [reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry], apply_authorized: false, generated_at: '2026-07-01T00:31:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory, entries: [{ ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry, raw_input: 'raw' }] } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory, report_count: 2 } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory, report_count: 0, latest_report: null, entries: [] } })).toBe(true);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest = { run_id: 'run_1', digest_status: 'Complete', digest_reason: 'Diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:32:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest, raw_input: 'raw' } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest, required_next_action_count: 1 } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest, report_count: 0, proposal_count: 0, complete_count: 0, required_next_actions: [] } })).toBe(true);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:33:00Z' };
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', digest_count: 1, latest_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, entries: [reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry], apply_authorized: false, generated_at: '2026-07-01T00:34:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory, latest_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, raw_input: 'raw' } } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory, digest_count: 2 } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory, digest_count: 0, latest_digest: null, entries: [] } })).toBe(true);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history report is complete; patch apply remains unauthorized.', history_status: 'Complete', digest_count: 1, latest_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:35:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport, latest_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, raw_input: 'raw' } } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport, required_next_action_count: 1 } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport, digest_count: 0, latest_digest: null, proposal_count: 0, complete_count: 0, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0 } })).toBe(true);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry = { report_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_1', report_status: 'Complete', history_status: 'Complete', digest_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:36:00Z' };
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history report is complete; patch apply remains unauthorized.', report_count: 1, latest_report: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry, entries: [reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry], apply_authorized: false, generated_at: '2026-07-01T00:37:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory, latest_report: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntry, raw_input: 'raw' } } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory, report_count: 2 } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory, report_count: 0, latest_report: null, entries: [] } })).toBe(true);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest = { run_id: 'run_1', digest_status: 'Complete', digest_reason: 'Diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:38:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest, raw_input: 'raw' } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest, required_next_action_count: 1 } })).toBe(false);
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:39:00Z' };
    const reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', digest_count: 1, latest_digest: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, entries: [reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry], apply_authorized: false, generated_at: '2026-07-01T00:40:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory, latest_digest: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntry, raw_input: 'raw' } } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: { ...reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory, digest_count: 2 } })).toBe(false);
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

  it('creates a task.start verification recovery request', async () => {
    const fingerprint = `sha256:${'a'.repeat(64)}`;
    const result = {
      task_id: 'task_recovery',
      run_id: 'run_recovery',
      status: 'Created',
      verification_recovery_admission: {
        source_task_id: 'task_source',
        source_run_id: 'run_source',
        recovery_task_id: 'task_recovery',
        recovery_run_id: 'run_recovery',
        failure_fingerprint: fingerprint,
        recovery_running_enabled: false,
        next_action: 'run_recovery_task_explicitly',
        replayed: false,
      },
    };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.startTask({
      goal: 'recover verifier failure',
      modeId: 'implementer',
      verificationRecoverySource: {
        source_task_id: 'task_source',
        source_run_id: 'run_source',
        expected_failure_fingerprint: fingerprint,
        authorize_recovery: true,
      },
    })).resolves.toEqual(result);
    expect(transport.requests).toEqual([{
      jsonrpc: '2.0',
      id: 1,
      method: 'task.start',
      params: {
        goal: 'recover verifier failure',
        mode_id: 'implementer',
        verification_recovery_source: {
          source_task_id: 'task_source',
          source_run_id: 'run_source',
          expected_failure_fingerprint: fingerprint,
          authorize_recovery: true,
        },
      },
    }]);
  });

  it('creates a task.start patch apply recovery request', async () => {
    const fingerprint = `sha256:${'a'.repeat(64)}`;
    const failureFingerprint = `sha256:${'b'.repeat(64)}`;
    const result = {
      task_id: 'task_recovery',
      run_id: 'run_recovery',
      status: 'Created',
      patch_apply_recovery_admission: {
        source_run_id: 'run_source',
        source_proposal_id: 'proposal_source',
        source_apply_id: 'apply_source',
        recovery_task_id: 'task_recovery',
        source_apply_fingerprint: fingerprint,
        failure_fingerprint: failureFingerprint,
        recovery_running_enabled: false,
        next_action: 'run_recovery_task_explicitly',
        replayed: false,
      },
    };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.startTask({
      goal: 'recover patch apply failure',
      modeId: 'implementer',
      patchApplyRecoverySource: {
        source_run_id: 'run_source',
        source_proposal_id: 'proposal_source',
        source_apply_id: 'apply_source',
        expected_source_apply_fingerprint: fingerprint,
        expected_failure_fingerprint: failureFingerprint,
        authorize_patch_apply_recovery: true,
      },
    })).resolves.toEqual(result);
    expect(transport.requests).toEqual([{
      jsonrpc: '2.0',
      id: 1,
      method: 'task.start',
      params: {
        goal: 'recover patch apply failure',
        mode_id: 'implementer',
        patch_apply_recovery_source: {
          source_run_id: 'run_source',
          source_proposal_id: 'proposal_source',
          source_apply_id: 'apply_source',
          expected_source_apply_fingerprint: fingerprint,
          expected_failure_fingerprint: failureFingerprint,
          authorize_patch_apply_recovery: true,
        },
      },
    }]);
  });

  it('accepts bounded cargo diagnostics and rejects unsafe diagnostic payloads', () => {
    const fingerprint = `sha256:${'a'.repeat(64)}`;
    const diagnostic = {
      tool_id: 'verification.cargo_check',
      check_id: 'cargo_check',
      diagnostic_kind: 'compile_error',
      severity: 'error',
      code: 'E0412',
      workspace_relative_path: 'src/lib.rs',
      line: 7,
      column: 12,
      truncated: false,
    };
    const testDiagnostic = {
      tool_id: 'verification.cargo_test',
      check_id: 'cargo_test',
      diagnostic_kind: 'panic_location',
      severity: 'error',
      test_name_hash: fingerprint,
      workspace_relative_path: 'src/lib.rs',
      line: 7,
      column: 9,
      truncated: false,
    };
    const gate = {
      status: 'Failed',
      required_verifier_count: 1,
      passed_verifier_count: 0,
      failed_verifier_count: 1,
      required_verifier_tool_ids: ['verification.cargo_check'],
      passed_verifier_tool_ids: [],
      failed_verifier_tool_ids: ['verification.cargo_check'],
      failure_reasons: ['verification.cargo_check:Failed'],
      bounded_cargo_diagnostics: [diagnostic],
      next_action: 'inspect_verification_failure_and_retry_task',
    };
    const provenance = {
      source_task_id: 'task_source',
      source_run_id: 'run_source',
      failure_fingerprint: fingerprint,
      required_verifier_count: 1,
      passed_verifier_count: 0,
      failed_verifier_count: 1,
      failed_verifier_tool_ids: ['verification.cargo_check'],
      failure_reasons: ['verification.cargo_check:Failed'],
      bounded_cargo_diagnostics: [diagnostic],
    };

    expect(isTaskRunResult({
      task_id: 'task_1',
      run_id: 'run_1',
      status: 'Failed',
      agent_loop: { final_state: 'Completed', completion_summary: 'verification failed' },
      verification_completion_gate: gate,
    })).toBe(true);
    expect(isLedgerEventSummary({
      event_id: 'event_1',
      task_id: 'task_1',
      run_id: 'run_1',
      kind: 'ToolExecutionFailed',
      timestamp: '2026-07-23T18:00:00Z',
      payload: {
        tool_id: 'verification.cargo_check',
        status: 'Failed',
        check_id: 'cargo_check',
        verification_status: 'Failed',
        bounded_cargo_diagnostics: [diagnostic],
      },
    })).toBe(true);
    expect(isTaskRecord({
      task_id: 'task_recovery',
      run_id: 'run_recovery',
      goal: 'recover cargo check failure',
      status: 'Running',
      verification_recovery_provenance: provenance,
      created_at: '2026-07-23T18:00:00Z',
      updated_at: '2026-07-23T18:00:01Z',
    })).toBe(true);
    expect(isLedgerEventSummary({
      event_id: 'event_cargo_test',
      task_id: 'task_1',
      run_id: 'run_1',
      kind: 'ToolExecutionFailed',
      timestamp: '2026-07-23T18:00:03Z',
      payload: {
        tool_id: 'verification.cargo_test',
        status: 'Failed',
        check_id: 'cargo_test',
        verification_status: 'Failed',
        bounded_cargo_diagnostics: [testDiagnostic],
      },
    })).toBe(true);

    expect(isTaskRunResult({
      task_id: 'task_1',
      run_id: 'run_1',
      status: 'Failed',
      agent_loop: { final_state: 'Completed', completion_summary: 'verification failed' },
      verification_completion_gate: {
        ...gate,
        bounded_cargo_diagnostics: [{ ...diagnostic, workspace_relative_path: '/tmp/src/lib.rs' }],
      },
    })).toBe(false);
    expect(isLedgerEventSummary({
      event_id: 'event_bad_test_name',
      task_id: 'task_1',
      run_id: 'run_1',
      kind: 'ToolExecutionFailed',
      timestamp: '2026-07-23T18:00:04Z',
      payload: {
        tool_id: 'verification.cargo_test',
        status: 'Failed',
        check_id: 'cargo_test',
        verification_status: 'Failed',
        bounded_cargo_diagnostics: [{ ...testDiagnostic, test_name: 'tests::fails' }],
      },
    })).toBe(false);
    expect(isLedgerEventSummary({
      event_id: 'event_bad_test_hash',
      task_id: 'task_1',
      run_id: 'run_1',
      kind: 'ToolExecutionFailed',
      timestamp: '2026-07-23T18:00:05Z',
      payload: {
        tool_id: 'verification.cargo_test',
        status: 'Failed',
        check_id: 'cargo_test',
        verification_status: 'Failed',
        bounded_cargo_diagnostics: [{ ...testDiagnostic, test_name_hash: 'tests::fails' }],
      },
    })).toBe(false);
    expect(isLedgerEventSummary({
      event_id: 'event_missing_panic_hash',
      task_id: 'task_1',
      run_id: 'run_1',
      kind: 'ToolExecutionFailed',
      timestamp: '2026-07-23T18:00:06Z',
      payload: {
        tool_id: 'verification.cargo_test',
        status: 'Failed',
        check_id: 'cargo_test',
        verification_status: 'Failed',
        bounded_cargo_diagnostics: [{ ...testDiagnostic, test_name_hash: undefined }],
      },
    })).toBe(false);
    expect(isLedgerEventSummary({
      event_id: 'event_missing_panic_location',
      task_id: 'task_1',
      run_id: 'run_1',
      kind: 'ToolExecutionFailed',
      timestamp: '2026-07-23T18:00:07Z',
      payload: {
        tool_id: 'verification.cargo_test',
        status: 'Failed',
        check_id: 'cargo_test',
        verification_status: 'Failed',
        bounded_cargo_diagnostics: [{ ...testDiagnostic, workspace_relative_path: undefined }],
      },
    })).toBe(false);
    expect(isLedgerEventSummary({
      event_id: 'event_2',
      task_id: 'task_1',
      run_id: 'run_1',
      kind: 'ToolExecutionFailed',
      timestamp: '2026-07-23T18:00:02Z',
      payload: {
        tool_id: 'verification.cargo_check',
        status: 'Failed',
        check_id: 'cargo_check',
        verification_status: 'Failed',
        bounded_cargo_diagnostics: [{ ...diagnostic, stdout: 'raw compiler text' }],
      },
    })).toBe(false);
    expect(isTaskRecord({
      task_id: 'task_recovery',
      run_id: 'run_recovery',
      goal: 'recover cargo check failure',
      status: 'Running',
      verification_recovery_provenance: {
        ...provenance,
        bounded_cargo_diagnostics: Array(6).fill(diagnostic),
      },
      created_at: '2026-07-23T18:00:00Z',
      updated_at: '2026-07-23T18:00:01Z',
    })).toBe(false);
  });

  it('accepts bounded task.run verification recovery repair outcomes and rejects raw fields', () => {
    const fingerprint = `sha256:${'a'.repeat(64)}`;
    const outcome = {
      gate_status: 'Passed',
      source_task_id: 'task_source',
      source_run_id: 'run_source',
      recovery_task_id: 'task_recovery',
      recovery_run_id: 'run_recovery',
      failure_fingerprint: fingerprint,
      failed_verifier_tool_ids: ['verification.cargo_fmt_check'],
      proposal_id: 'proposal_1',
      proposal_count: 1,
      replayed: false,
      apply_enabled: false,
      next_action: 'review_and_authorize_recovery_proposal',
    };

    expect(isTaskRunVerificationRecoveryRepairOutcome(outcome)).toBe(true);
    expect(isTaskRunResult({
      task_id: 'task_recovery',
      run_id: 'run_recovery',
      status: 'Completed',
      agent_loop: { final_state: 'Completed', completion_summary: 'proposal created' },
      verification_recovery_repair: outcome,
    })).toBe(true);
    expect(isTaskRunVerificationRecoveryRepairOutcome({ ...outcome, stdout: 'raw output' })).toBe(false);
    expect(isTaskRunVerificationRecoveryRepairOutcome({ ...outcome, apply_enabled: true })).toBe(false);
    expect(isTaskRunVerificationRecoveryRepairOutcome({
      ...outcome,
      gate_status: 'Failed',
      proposal_id: null,
      proposal_count: 0,
      failure_reason: 'MissingRecoveryRepairProposal',
      next_action: 'inspect_recovery_repair_gate_failure',
    })).toBe(true);
    expect(isTaskRunVerificationRecoveryRepairOutcome({
      ...outcome,
      gate_status: 'Failed',
      proposal_id: null,
      proposal_count: 1,
      failure_reason: 'RecoveryRepairProposalNotApplicable',
      next_action: 'inspect_recovery_repair_gate_failure',
    })).toBe(true);
    expect(isTaskRunVerificationRecoveryRepairOutcome({
      ...outcome,
      gate_status: 'Failed',
      proposal_id: null,
      proposal_count: 1,
      failure_reason: 'MissingRecoveryRepairProposal',
      next_action: 'inspect_recovery_repair_gate_failure',
    })).toBe(false);
  });

  it('accepts bounded task.run verification recovery retry outcomes and rejects raw fields', () => {
    const failureFingerprint = `sha256:${'a'.repeat(64)}`;
    const applyFingerprint = `sha256:${'b'.repeat(64)}`;
    const outcome = {
      source_task_id: 'task_source',
      source_run_id: 'run_source',
      recovery_task_id: 'task_recovery',
      recovery_run_id: 'run_recovery',
      retry_task_id: 'task_retry',
      retry_run_id: 'run_retry',
      proposal_id: 'proposal_1',
      apply_id: 'apply_1',
      failure_fingerprint: failureFingerprint,
      apply_fingerprint: applyFingerprint,
      retried_verifier_tool_ids: ['verification.cargo_fmt_check'],
      passed_verifier_tool_ids: [],
      failed_verifier_tool_ids: ['verification.cargo_fmt_check'],
      retry_status: 'Failed',
      replayed: false,
      next_action: 'inspect_verification_failure_and_retry_task',
    };

    expect(isTaskRunVerificationRecoveryRetryOutcome(outcome)).toBe(true);
    expect(isTaskRunResult({
      task_id: 'task_retry',
      run_id: 'run_retry',
      status: 'Failed',
      agent_loop: { final_state: 'Failed', completion_summary: 'retry failed' },
      verification_recovery_retry: outcome,
    })).toBe(true);
    expect(isTaskRunVerificationRecoveryRetryOutcome({ ...outcome, stdout: 'raw output' })).toBe(false);
    expect(isTaskRunVerificationRecoveryRetryOutcome({ ...outcome, retried_verifier_tool_ids: [] })).toBe(false);
  });

  it('creates a task.run request', async () => {
    const result = { task_id: 'task_1', run_id: 'run_1', status: 'Completed', agent_loop: { final_state: 'Completed', completion_summary: 'LLM agent loop completed for task_1' } };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.runTask('task_1')).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'task.run', params: { task_id: 'task_1' } }]);
  });

  it('creates a headless.continue_once request without owning selection policy', async () => {
    const params = {
      authorize: true as const,
      expected_progress_fingerprint: taskListProgressOverview.source_fingerprint,
      expected_aggregate_sequence: taskListProgressOverview.aggregate_sequence,
      continuation_id: 'continue.once:client',
      max_steps: 2,
    };
    const taskRunResult = {
      task_id: 'task_1',
      run_id: 'run_1',
      status: 'Completed',
      agent_loop: { final_state: 'Completed', completion_summary: 'done' },
    };
    const result = {
      status: 'task_executed',
      decision_id: `headless_decision_${'a'.repeat(32)}`,
      continuation_id: 'continue.once:client',
      selected_task_id: 'task_1',
      selected_run_id: 'run_1',
      candidate_count: 1,
      expected_progress_fingerprint: taskListProgressOverview.source_fingerprint,
      expected_aggregate_sequence: taskListProgressOverview.aggregate_sequence,
      current_progress_fingerprint: taskListProgressOverview.source_fingerprint,
      current_aggregate_sequence: taskListProgressOverview.aggregate_sequence,
      post_progress_fingerprint: `sha256:${'c'.repeat(64)}`,
      post_aggregate_sequence: taskListProgressOverview.aggregate_sequence + 1,
      stale: false,
      replayed: false,
      task_run_result: taskRunResult,
      max_steps: 2,
      step_count: 1,
      executed_count: 1,
      replayed_count: 0,
      stop_reason: 'budget_exhausted',
      steps: [{
        step_index: 1,
        status: 'task_executed',
        decision_id: `headless_decision_${'a'.repeat(32)}`,
        continuation_id: 'continue.once:client.step.1',
        selected_task_id: 'task_1',
        selected_run_id: 'run_1',
        candidate_count: 1,
        current_progress_fingerprint: taskListProgressOverview.source_fingerprint,
        current_aggregate_sequence: taskListProgressOverview.aggregate_sequence,
        post_progress_fingerprint: `sha256:${'c'.repeat(64)}`,
        post_aggregate_sequence: taskListProgressOverview.aggregate_sequence + 1,
        replayed: false,
        next_action: 'inspect_progress_overview',
      }],
      next_action: 'inspect_progress_overview',
    };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.continueOnceHeadless(params)).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'headless.continue_once', params }]);
  });

  it('creates a headless.continue_once verification recovery admission request', async () => {
    const fingerprint = `sha256:${'d'.repeat(64)}`;
    const params = {
      authorize: true as const,
      expected_progress_fingerprint: taskListProgressOverview.source_fingerprint,
      expected_aggregate_sequence: taskListProgressOverview.aggregate_sequence,
      continuation_id: 'continue.once:recovery',
      verification_recovery_source: {
        source_task_id: 'task_source',
        source_run_id: 'run_source',
        expected_failure_fingerprint: fingerprint,
        authorize_recovery: true,
      },
      verification_recovery_goal: 'Recover failed verification',
      verification_recovery_mode_id: 'implementer',
    };
    const result = {
      status: 'task_in_progress',
      decision_id: `headless_decision_${'b'.repeat(32)}`,
      continuation_id: 'continue.once:recovery',
      selected_task_id: 'task_recovery',
      selected_run_id: 'run_recovery',
      candidate_count: 1,
      expected_progress_fingerprint: taskListProgressOverview.source_fingerprint,
      expected_aggregate_sequence: taskListProgressOverview.aggregate_sequence,
      current_progress_fingerprint: taskListProgressOverview.source_fingerprint,
      current_aggregate_sequence: taskListProgressOverview.aggregate_sequence,
      post_progress_fingerprint: `sha256:${'e'.repeat(64)}`,
      post_aggregate_sequence: taskListProgressOverview.aggregate_sequence + 1,
      stale: false,
      replayed: false,
      task_run_result: null,
      next_route: {
        kind: 'run_recovery_task_explicitly',
        reason: 'Recovery task admitted; run explicitly.',
        task_id: 'task_recovery',
        run_id: 'run_recovery',
        failure_fingerprint: fingerprint,
        progress_fingerprint: `sha256:${'e'.repeat(64)}`,
        aggregate_sequence: taskListProgressOverview.aggregate_sequence + 1,
        next_action: 'run_recovery_task_explicitly',
      },
      next_action: 'run_recovery_task_explicitly',
    };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.continueOnceHeadless(params)).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'headless.continue_once', params }]);
  });

  it('creates a headless.continue_once verification recovery run request', async () => {
    const fingerprint = `sha256:${'d'.repeat(64)}`;
    const params = {
      authorize: true as const,
      expected_progress_fingerprint: taskListProgressOverview.source_fingerprint,
      expected_aggregate_sequence: taskListProgressOverview.aggregate_sequence,
      continuation_id: 'continue.once:recovery.run',
      verification_recovery_run_target: {
        recovery_task_id: 'task_recovery',
        recovery_run_id: 'run_recovery',
        source_task_id: 'task_source',
        source_run_id: 'run_source',
        expected_failure_fingerprint: fingerprint,
        authorize_recovery_run: true,
      },
    };
    const result = {
      status: 'task_executed',
      decision_id: `headless_decision_${'c'.repeat(32)}`,
      continuation_id: 'continue.once:recovery.run',
      selected_task_id: 'task_recovery',
      selected_run_id: 'run_recovery',
      candidate_count: 1,
      expected_progress_fingerprint: taskListProgressOverview.source_fingerprint,
      expected_aggregate_sequence: taskListProgressOverview.aggregate_sequence,
      current_progress_fingerprint: taskListProgressOverview.source_fingerprint,
      current_aggregate_sequence: taskListProgressOverview.aggregate_sequence,
      post_progress_fingerprint: `sha256:${'f'.repeat(64)}`,
      post_aggregate_sequence: taskListProgressOverview.aggregate_sequence + 1,
      stale: false,
      replayed: false,
      task_run_result: {
        task_id: 'task_recovery',
        run_id: 'run_recovery',
        status: 'Completed',
        agent_loop: { final_state: 'Completed', completion_summary: 'recovery proposal created' },
        verification_recovery_repair: {
          source_task_id: 'task_source',
          source_run_id: 'run_source',
          recovery_task_id: 'task_recovery',
          recovery_run_id: 'run_recovery',
          failure_fingerprint: fingerprint,
          failed_verifier_tool_ids: ['verification.cargo_fmt_check'],
          gate_status: 'Passed',
          proposal_id: 'proposal_recovery_1',
          proposal_count: 1,
          apply_enabled: false,
          next_action: 'review_and_authorize_recovery_proposal',
          replayed: false,
        },
      },
      next_route: {
        kind: 'review_and_authorize_recovery_proposal',
        reason: 'Recovery repair produced one bounded proposal; review and authorize it explicitly.',
        task_id: 'task_recovery',
        run_id: 'run_recovery',
        proposal_id: 'proposal_recovery_1',
        failure_fingerprint: fingerprint,
        progress_fingerprint: `sha256:${'f'.repeat(64)}`,
        aggregate_sequence: taskListProgressOverview.aggregate_sequence + 1,
        next_action: 'review_and_authorize_recovery_proposal',
      },
      next_action: 'review_and_authorize_recovery_proposal',
    };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.continueOnceHeadless(params)).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'headless.continue_once', params }]);
  });

  it('creates a headless.run.advance request', async () => {
    const params = {
      authorize: true as const,
      session_id: 'm17.session',
      advance_id: 'm17.advance.1',
      expected_session_sequence: 1,
      max_steps: 1,
      expected_progress_fingerprint: taskListProgressOverview.source_fingerprint,
      expected_aggregate_sequence: taskListProgressOverview.aggregate_sequence,
    };
    const result = {
      status: 'task_executed',
      session_id: 'm17.session',
      advance_id: 'm17.advance.1',
      session_sequence: 1,
      replayed: false,
      start_progress: {
        progress_fingerprint: taskListProgressOverview.source_fingerprint,
        aggregate_sequence: taskListProgressOverview.aggregate_sequence,
      },
      post_progress: {
        progress_fingerprint: `sha256:${'c'.repeat(64)}`,
        aggregate_sequence: taskListProgressOverview.aggregate_sequence + 1,
      },
      max_steps: 1,
      step_count: 1,
      executed_count: 1,
      replayed_count: 0,
      stop_reason: 'budget_exhausted',
      checkpoint_fingerprint: `sha256:${'e'.repeat(64)}`,
      steps: [{
        step_index: 1,
        status: 'task_executed',
        decision_id: `headless_decision_${'a'.repeat(32)}`,
        continuation_id: 'run.m17.session.1',
        selected_task_id: 'task_1',
        selected_run_id: 'run_1',
        candidate_count: 1,
        current_progress_fingerprint: taskListProgressOverview.source_fingerprint,
        current_aggregate_sequence: taskListProgressOverview.aggregate_sequence,
        post_progress_fingerprint: `sha256:${'c'.repeat(64)}`,
        post_aggregate_sequence: taskListProgressOverview.aggregate_sequence + 1,
        replayed: false,
        next_action: 'inspect_progress_overview',
      }],
      next_action: 'inspect_progress_overview',
    };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.advanceHeadlessRun(params)).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'headless.run.advance', params }]);
  });

  it('creates a headless.run.drive request', async () => {
    const advance = {
      status: 'task_executed',
      session_id: 'm17.session',
      advance_id: 'm17.drive.1.2',
      session_sequence: 2,
      replayed: false,
      start_progress: {
        progress_fingerprint: taskListProgressOverview.source_fingerprint,
        aggregate_sequence: taskListProgressOverview.aggregate_sequence,
      },
      post_progress: {
        progress_fingerprint: `sha256:${'c'.repeat(64)}`,
        aggregate_sequence: taskListProgressOverview.aggregate_sequence + 1,
      },
      max_steps: 1,
      step_count: 1,
      executed_count: 1,
      replayed_count: 0,
      stop_reason: 'budget_exhausted',
      checkpoint_fingerprint: `sha256:${'e'.repeat(64)}`,
      steps: [{
        step_index: 1,
        status: 'task_executed',
        decision_id: `headless_decision_${'a'.repeat(32)}`,
        continuation_id: 'run.m17.session.2',
        selected_task_id: 'task_1',
        selected_run_id: 'run_1',
        candidate_count: 1,
        current_progress_fingerprint: taskListProgressOverview.source_fingerprint,
        current_aggregate_sequence: taskListProgressOverview.aggregate_sequence,
        post_progress_fingerprint: `sha256:${'c'.repeat(64)}`,
        post_aggregate_sequence: taskListProgressOverview.aggregate_sequence + 1,
        replayed: false,
        next_action: 'inspect_progress_overview',
      }],
      next_action: 'inspect_progress_overview',
    };
    const params = {
      authorize: true as const,
      session_id: 'm17.session',
      drive_id: 'm17.drive.1',
      expected_start_session_sequence: 1,
      max_advances: 1,
      max_steps_per_advance: 1,
    };
    const result = {
      status: 'task_executed',
      session_id: 'm17.session',
      drive_id: 'm17.drive.1',
      start_session_sequence: 1,
      end_session_sequence: 2,
      replayed: false,
      max_advances: 1,
      max_steps_per_advance: 1,
      advance_count: 1,
      executed_count: 1,
      replayed_count: 0,
      stop_reason: 'budget_exhausted',
      drive_fingerprint: `sha256:${'f'.repeat(64)}`,
      start_progress: advance.start_progress,
      post_progress: advance.post_progress,
      advances: [advance],
      next_action: 'inspect_progress_overview',
    };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.driveHeadlessRun(params)).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'headless.run.drive', params }]);
  });

  it('creates a task.run request with selected index context', async () => {
    const selectedIndexContext = {
      query_id: 'query_abcdef1234567890',
      selection_id: 'selection_0123456789abcdef',
      query_fingerprint: `sha256:${'c'.repeat(64)}`,
      selection_fingerprint: `sha256:${'d'.repeat(64)}`,
      snapshot: {
        index_id: 'idx_abcdef1234567890',
        root: '.',
        workspace_fingerprint: `sha256:${'a'.repeat(64)}`,
        snapshot_fingerprint: `sha256:${'b'.repeat(64)}`,
        built_at: '2026-07-24T00:00:00Z',
        truncated: false,
      },
      path: 'src/runtime/query.rs',
      file_kind: 'Rust',
      content: 'pub fn selected() {}\n',
      truncated: false,
      bytes_read: 21,
      content_sha256: `sha256:${'e'.repeat(64)}`,
      content_hash_verified: true,
      ledger_event_id: 'event_3',
      ledger_event_kind: 'CodebaseIndexSelectionReadCompleted',
      next_action: 'use_selected_file_context_for_prompt_materialization',
    } as const;
    const result = {
      task_id: 'task_1',
      run_id: 'run_1',
      status: 'Completed',
      agent_loop: { final_state: 'Completed', completion_summary: 'LLM agent loop completed for task_1' },
      selected_index_prompt_context: {
        prompt_context_id: 'ctx_0123456789abcdef',
        source_event_id: 'event_3',
        source_event_kind: 'CodebaseIndexSelectionReadCompleted',
        query_id: selectedIndexContext.query_id,
        selection_id: selectedIndexContext.selection_id,
        query_fingerprint: selectedIndexContext.query_fingerprint,
        selection_fingerprint: selectedIndexContext.selection_fingerprint,
        index_id: selectedIndexContext.snapshot.index_id,
        workspace_fingerprint: selectedIndexContext.snapshot.workspace_fingerprint,
        snapshot_fingerprint: selectedIndexContext.snapshot.snapshot_fingerprint,
        read_path_fingerprint: `sha256:${'f'.repeat(64)}`,
        file_kind: 'Rust',
        bytes_read: 21,
        content_char_count: 21,
        materialized_content_char_count: 21,
        content_truncated_for_prompt: false,
        content_sha256: selectedIndexContext.content_sha256,
        prompt_preview_redacted: true,
        next_action: 'continue_task_execution_with_materialized_context',
      },
    } as const;
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.runTask('task_1', selectedIndexContext)).resolves.toEqual(result);
    expect(transport.requests).toEqual([{
      jsonrpc: '2.0',
      id: 1,
      method: 'task.run',
      params: { task_id: 'task_1', selected_index_context: selectedIndexContext },
    }]);
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
      run: { run_id: 'run_1', task_id: 'task_1', status: 'Completed', progress_snapshot: progressSnapshot, child_task_count: 1, child_task_ids: ['task_child_1'], child_tasks: [{ task_id: 'task_child_1', run_id: 'run_child_1', status: 'Completed', parent_task_id: 'task_1', parent_run_id: 'run_1', source_candidate_id: 'subtask_1', source_handoff_envelope_id: 'handoff_1', source_handoff_envelope_fingerprint: 'sha256:child', source_intent_summary: childSourceIntentSummary, event_count: 8, has_agent_loop_completed: true, completion_final_state: 'Completed', completion_summary_preview: 'completed child', final_response_preview: 'done' }], event_count: 2, has_tool_execution_completed: true, has_subtask_orchestration_queued: true, subtask_queue_count: 1, has_subtask_handoff_prepared: true, subtask_handoff_count: 1, has_subtask_scheduler_readiness: true, subtask_scheduler_readiness_count: 1, has_subtask_dispatch_plan_prepared: true, subtask_dispatch_plan_count: 1, has_subtask_dispatch_contract_prepared: true, subtask_dispatch_contract_count: 1, has_subtask_dispatch_admission_evaluated: true, subtask_dispatch_admission_count: 1, has_subtask_dispatch_readiness_snapshot: true, subtask_dispatch_readiness_snapshot_count: 1, has_subtask_dispatcher_guard_verdict: true, subtask_dispatcher_guard_verdict_count: 1, has_subtask_dispatch_decision: true, subtask_dispatch_decision_count: 1, has_subtask_dispatch_candidate_manifest: true, subtask_dispatch_candidate_manifest_count: 1, has_subtask_dispatch_handoff_envelope: true, subtask_dispatch_handoff_envelope_count: 1, has_second_pass: true, final_response_preview: 'done', timeline: ['TaskStarted'] },
    };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.inspectTask('task_1')).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'task.inspect', params: { task_id: 'task_1' } }]);
  });

  it('creates a run.inspect request', async () => {
    const run = { run_id: 'run_1', task_id: 'task_1', status: 'Completed', progress_snapshot: progressSnapshot, child_task_count: 1, child_task_ids: ['task_child_1'], child_tasks: [{ task_id: 'task_child_1', run_id: 'run_child_1', status: 'Completed', parent_task_id: 'task_1', parent_run_id: 'run_1', source_candidate_id: 'subtask_1', source_handoff_envelope_id: 'handoff_1', source_handoff_envelope_fingerprint: 'sha256:child', source_intent_summary: childSourceIntentSummary, event_count: 8, has_agent_loop_completed: true, completion_final_state: 'Completed', completion_summary_preview: 'completed child', final_response_preview: 'done' }], event_count: 2, has_tool_execution_completed: true, has_subtask_orchestration_queued: true, subtask_queue_count: 1, has_subtask_handoff_prepared: true, subtask_handoff_count: 1, has_subtask_scheduler_readiness: true, subtask_scheduler_readiness_count: 1, has_subtask_dispatch_plan_prepared: true, subtask_dispatch_plan_count: 1, has_subtask_dispatch_contract_prepared: true, subtask_dispatch_contract_count: 1, has_subtask_dispatch_admission_evaluated: true, subtask_dispatch_admission_count: 1, has_subtask_dispatch_readiness_snapshot: true, subtask_dispatch_readiness_snapshot_count: 1, has_subtask_dispatcher_guard_verdict: true, subtask_dispatcher_guard_verdict_count: 1, has_subtask_dispatch_decision: true, subtask_dispatch_decision_count: 1, has_subtask_dispatch_candidate_manifest: true, subtask_dispatch_candidate_manifest_count: 1, has_subtask_dispatch_handoff_envelope: true, subtask_dispatch_handoff_envelope_count: 1, has_second_pass: false, final_response_preview: 'done', timeline: ['TaskStarted'] };
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
    const applyPlan = { proposal_id: 'proposal_1', plan_id: 'plan_1', status: 'Ready', checklist: [{ name: 'apply_execution_available', status: 'Pass', reason: 'Patch apply is available through proposal.apply.' }] };
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
    const applyPlan = { proposal_id: 'proposal_1', plan_id: 'plan_1', status: 'Ready', checklist: [{ name: 'apply_execution_available', status: 'Pass', reason: 'Patch apply is available through proposal.apply.' }] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, snapshot, apply_plan: applyPlan } });
    await expect(new RuntimeClient(transport).preflightProposal('run_1', 'proposal_1')).resolves.toEqual({ proposal, snapshot, apply_plan: applyPlan });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.preflight', params: { run_id: 'run_1', proposal_id: 'proposal_1' } }]);
  });

  it('creates a proposal.readiness request', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'README.md', operation: 'replace_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const report = { proposal_id: 'proposal_1', report_id: 'report_1', readiness_status: 'Ready', readiness_reason: null, generated_at: '2026-07-01T00:00:00Z', checklist: [{ name: 'apply_execution_supported', status: 'Pass', reason: 'Patch apply execution is available through proposal.apply.' }], summary: 'Ready for final human review. Controlled apply execution is available through proposal.apply.' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, report } });
    await expect(new RuntimeClient(transport).readinessProposal('run_1', 'proposal_1')).resolves.toEqual({ proposal, report });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.readiness', params: { run_id: 'run_1', proposal_id: 'proposal_1' } }]);
  });

  it('creates a proposal.applyCapability request', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'README.md', operation: 'replace_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const capability = { proposal_id: 'proposal_1', capability_id: 'apply_capability_1', apply_supported: true, apply_enabled: true, mode: 'controlled_apply', reason: 'proposal.apply can execute after explicit one-time authorization and expected target hash verification.', required_gates: ['proposal_valid', 'runtime_apply_supported'], can_apply_now: true, checked_at: '2026-07-01T00:00:00Z', check_count: 1, failed_checks: [], blocked_checks: [], checklist: [{ name: 'apply_execution_supported', status: 'Pass', reason: 'Patch apply execution is available through proposal.apply.' }] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, capability } });
    await expect(new RuntimeClient(transport).inspectApplyCapability('run_1', 'proposal_1')).resolves.toEqual({ proposal, capability });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.applyCapability', params: { run_id: 'run_1', proposal_id: 'proposal_1' } }]);
  });

  it('creates a proposal.applyDryRun request', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'README.md', operation: 'replace_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const dry_run = { proposal_id: 'proposal_1', dry_run_id: 'apply_dry_run_1', dry_run_status: 'Completed', dry_run_reason: 'Dry run completed without applying a patch or changing workspace files.', checked_at: '2026-07-01T00:00:00Z', required_gates: ['proposal_valid', 'readiness_ready', 'runtime_apply_supported'], check_count: 1, failed_checks: [], blocked_checks: [], no_patch_applied: true, apply_executed: false, workspace_files_changed: false, checklist: [{ name: 'apply_execution_supported', status: 'Pass', reason: 'Patch apply execution is available through proposal.apply; dry-run does not invoke it.' }] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, dry_run } });
    await expect(new RuntimeClient(transport).applyDryRun('run_1', 'proposal_1')).resolves.toEqual({ proposal, dry_run });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.applyDryRun', params: { run_id: 'run_1', proposal_id: 'proposal_1' } }]);
  });

  it('creates a proposal.apply request', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'README.md', operation: 'replace_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const apply_result = { proposal_id: 'proposal_1', apply_id: 'apply_1', apply_status: 'Applied', apply_reason: 'Patch applied and post-write hash verification succeeded.', authorization_id: 'apply_auth_1', authorization_consumed: true, applied: true, operation: 'replace_file', atomic_replacement_completed: true, atomic_create_completed: false, atomic_delete_completed: false, path: 'README.md', expected_target_sha256: 'sha256:def', expected_target_absent: null, pre_write_target_sha256: 'sha256:def', pre_write_target_exists: true, post_write_sha256: 'sha256:123', post_delete_target_exists: null, content_chars: 3, content_bytes: 3, checked_at: '2026-07-01T00:00:00Z', applied_at: '2026-07-01T00:00:01Z', temp_file_cleaned: true, check_count: 2, failed_checks: [], blocked_checks: [], checklist: [{ name: 'expected_target_hash_matches', status: 'Pass', reason: null }, { name: 'post_write_sha256_verified', status: 'Pass', reason: null }] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, apply_result } });
    await expect(new RuntimeClient(transport).applyProposal('run_1', 'proposal_1', 'sha256:def', 'new')).resolves.toEqual({ proposal, apply_result });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.apply', params: { run_id: 'run_1', proposal_id: 'proposal_1', expected_target_sha256: 'sha256:def', replacement_content: 'new', authorize: true } }]);
  });

  it('creates a proposal.apply patch_file multi-hunk request', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'README.md', operation: 'patch_file', content_preview: '[patch_file multi_hunk count=2 total_chars=16]', content_chars: 16, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, hunk_count: 2, hunk_fingerprint: 'sha256:abc', approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const apply_result = { proposal_id: 'proposal_1', apply_id: 'apply_1', apply_status: 'Applied', apply_reason: 'Patch-file hunks applied and post-write SHA-256 verified.', authorization_id: 'apply_auth_1', authorization_consumed: true, applied: true, operation: 'patch_file', atomic_replacement_completed: true, atomic_create_completed: false, atomic_delete_completed: false, path: 'README.md', expected_target_sha256: 'sha256:def', expected_target_absent: null, pre_write_target_sha256: 'sha256:def', pre_write_target_exists: true, post_write_sha256: 'sha256:123', post_delete_target_exists: null, content_chars: 16, content_bytes: 16, checked_at: '2026-07-01T00:00:00Z', applied_at: '2026-07-01T00:00:01Z', temp_file_cleaned: true, check_count: 2, failed_checks: [], blocked_checks: [], checklist: [{ name: 'patch_hunk_matches_proposal', status: 'Pass', reason: null }, { name: 'post_write_sha256_verified', status: 'Pass', reason: null }] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, apply_result } });
    const hunks = [{ old_text: 'beta\n', new_text: 'delta\n' }, { old_text: 'omega\n', new_text: 'theta\n' }];
    await expect(new RuntimeClient(transport).applyPatchFileProposal('run_1', 'proposal_1', 'sha256:def', hunks)).resolves.toEqual({ proposal, apply_result });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.apply', params: { run_id: 'run_1', proposal_id: 'proposal_1', expected_target_sha256: 'sha256:def', patch_hunks: hunks, authorize: true } }]);
  });

  it('creates a proposal.apply create_file request', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'notes/new.md', operation: 'create_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/notes/new.md', diff_truncated: false, diff_redacted: false, approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const apply_result = { proposal_id: 'proposal_1', apply_id: 'apply_1', apply_status: 'Applied', apply_reason: 'File created and post-write SHA-256 verified.', authorization_id: 'apply_auth_1', authorization_consumed: true, applied: true, operation: 'create_file', atomic_replacement_completed: false, atomic_create_completed: true, atomic_delete_completed: false, path: 'notes/new.md', expected_target_sha256: null, expected_target_absent: true, pre_write_target_sha256: null, pre_write_target_exists: false, post_write_sha256: 'sha256:123', post_delete_target_exists: null, content_chars: 3, content_bytes: 3, checked_at: '2026-07-01T00:00:00Z', applied_at: '2026-07-01T00:00:01Z', temp_file_cleaned: true, check_count: 2, failed_checks: [], blocked_checks: [], checklist: [{ name: 'target_absent_current', status: 'Pass', reason: null }, { name: 'post_write_sha256_verified', status: 'Pass', reason: null }] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, apply_result } });
    await expect(new RuntimeClient(transport).applyCreateFileProposal('run_1', 'proposal_1', 'new')).resolves.toEqual({ proposal, apply_result });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.apply', params: { run_id: 'run_1', proposal_id: 'proposal_1', expected_target_absent: true, replacement_content: 'new', authorize: true } }]);
  });

  it('creates a proposal.apply create_file transaction request', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'notes/a.md', operation: 'create_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/notes/a.md', diff_truncated: false, diff_redacted: false, approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const transaction_items = [
      { proposal_id: 'proposal_1', apply_status: 'Applied', apply_reason: 'File created and post-write SHA-256 verified.', operation: 'create_file', path: 'notes/a.md', expected_target_sha256: null, expected_target_absent: true, pre_write_target_sha256: null, pre_write_target_exists: false, post_write_sha256: 'sha256:123', content_chars: 3, content_bytes: 3, atomic_replacement_completed: false, atomic_create_completed: true, applied: true, temp_file_cleaned: true },
      { proposal_id: 'proposal_2', apply_status: 'Applied', apply_reason: 'File created and post-write SHA-256 verified.', operation: 'create_file', path: 'notes/b.md', expected_target_sha256: null, expected_target_absent: true, pre_write_target_sha256: null, pre_write_target_exists: false, post_write_sha256: 'sha256:456', content_chars: 3, content_bytes: 3, atomic_replacement_completed: false, atomic_create_completed: true, applied: true, temp_file_cleaned: true }
    ];
    const apply_result = { proposal_id: 'proposal_1', apply_id: 'apply_1', apply_status: 'Applied', apply_reason: 'Create-file transaction applied and all post-write SHA-256 values verified.', authorization_id: 'apply_tx_auth_1', authorization_consumed: true, applied: true, operation: 'create_file_transaction', atomic_replacement_completed: false, atomic_create_completed: true, atomic_delete_completed: false, path: '[transaction]', expected_target_sha256: null, expected_target_absent: true, pre_write_target_sha256: null, pre_write_target_exists: null, post_write_sha256: null, post_delete_target_exists: null, content_chars: 6, content_bytes: 6, checked_at: '2026-07-01T00:00:00Z', applied_at: '2026-07-01T00:00:01Z', temp_file_cleaned: true, check_count: 2, failed_checks: [], blocked_checks: [], checklist: [{ name: 'transaction_atomic_creates_completed', status: 'Pass', reason: null }, { name: 'transaction_post_write_sha256_verified', status: 'Pass', reason: null }], transaction_id: 'apply_tx_1', transaction_status: 'Applied', transaction_items };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, apply_result } });
    await expect(new RuntimeClient(transport).applyCreateFileTransaction('run_1', [{ proposal_id: 'proposal_1', expected_target_absent: true, replacement_content: 'new' }, { proposal_id: 'proposal_2', expected_target_absent: true, replacement_content: 'two' }])).resolves.toEqual({ proposal, apply_result });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.apply', params: { run_id: 'run_1', proposal_id: 'proposal_1', transaction_items: [{ proposal_id: 'proposal_1', expected_target_absent: true, replacement_content: 'new' }, { proposal_id: 'proposal_2', expected_target_absent: true, replacement_content: 'two' }], authorize: true } }]);
  });

  it('creates a proposal.apply delete_file request', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'notes/obsolete.md', operation: 'delete_file', content_preview: '', content_chars: 0, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/notes/obsolete.md', diff_truncated: false, diff_redacted: false, approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const apply_result = { proposal_id: 'proposal_1', apply_id: 'apply_1', apply_status: 'Applied', apply_reason: 'File deleted and post-delete absence verified.', authorization_id: 'apply_auth_1', authorization_consumed: true, applied: true, operation: 'delete_file', atomic_replacement_completed: false, atomic_create_completed: false, atomic_delete_completed: true, path: 'notes/obsolete.md', expected_target_sha256: 'sha256:def', expected_target_absent: null, pre_write_target_sha256: 'sha256:def', pre_write_target_exists: true, post_write_sha256: null, post_delete_target_exists: false, content_chars: 0, content_bytes: 0, checked_at: '2026-07-01T00:00:00Z', applied_at: '2026-07-01T00:00:01Z', temp_file_cleaned: true, check_count: 2, failed_checks: [], blocked_checks: [], checklist: [{ name: 'expected_target_hash_matches', status: 'Pass', reason: null }, { name: 'post_delete_absence_verified', status: 'Pass', reason: null }] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, apply_result } });
    await expect(new RuntimeClient(transport).applyDeleteFileProposal('run_1', 'proposal_1', 'sha256:def')).resolves.toEqual({ proposal, apply_result });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.apply', params: { run_id: 'run_1', proposal_id: 'proposal_1', expected_target_sha256: 'sha256:def', authorize: true } }]);
  });

  it('creates a proposal.applyDryRunHistory request', async () => {
    const proposal = { proposal_id: 'proposal_1', path: 'README.md', operation: 'replace_file', content_preview: 'new', content_chars: 3, truncated: false, validation_status: 'Valid', validation_reason: null, diff_preview: '--- a/README.md', diff_truncated: false, diff_redacted: false, approval_status: 'Approved', approval_reason: 'ok', approved_at: '2026-06-30T00:00:00Z', rejected_at: null, approval_reason_redacted: false };
    const entry = { proposal_id: 'proposal_1', dry_run_id: 'apply_dry_run_1', dry_run_status: 'Completed', dry_run_reason: 'Dry run completed without applying a patch or changing workspace files.', checked_at: '2026-07-01T00:00:00Z', required_gates: ['proposal_valid', 'readiness_ready', 'runtime_apply_supported'], check_count: 1, failed_checks: [], blocked_checks: [], no_patch_applied: true, apply_executed: false, workspace_files_changed: false };
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
    const review_bundle = { proposal_id: 'proposal_1', review_status: 'Complete', review_reason: 'All proposal review signals are available for final human review.', latest_readiness: { status: 'Ready', reason: null, generated_at: '2026-07-01T00:00:00Z', source_id: 'report_1' }, latest_apply_capability: { status: 'true', reason: 'proposal.apply can execute after explicit one-time authorization and expected target hash verification.', generated_at: '2026-07-01T00:00:00Z', source_id: 'apply_capability_1' }, latest_apply_dry_run: { status: 'Completed', reason: 'Dry run completed without applying a patch or changing workspace files.', generated_at: '2026-07-01T00:00:00Z', source_id: 'apply_dry_run_1' }, audit_event_count: 1, latest_audit_event: entry, required_next_actions: [], generated_at: '2026-07-01T00:01:00Z' };
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
    const review_bundle = { proposal_id: 'proposal_1', review_status: 'Complete', review_reason: 'All proposal review signals are available for final human review.', latest_readiness: { status: 'Ready', reason: null, generated_at: '2026-07-01T00:00:00Z', source_id: 'report_1' }, latest_apply_capability: { status: 'true', reason: 'proposal.apply can execute after explicit one-time authorization and expected target hash verification.', generated_at: '2026-07-01T00:00:00Z', source_id: 'apply_capability_1' }, latest_apply_dry_run: { status: 'Completed', reason: 'Dry run completed without applying a patch or changing workspace files.', generated_at: '2026-07-01T00:00:00Z', source_id: 'apply_dry_run_1' }, audit_event_count: 1, latest_audit_event: entry, required_next_actions: [], generated_at: '2026-07-01T00:01:00Z' };
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

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistory request', async () => {
    const latest_report = { report_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_1', report_status: 'Complete', history_status: 'Complete', digest_status: 'Complete', digest_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:14:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report is complete; patch apply remains unauthorized.', report_count: 1, latest_report, entries: [latest_report], apply_authorized: false, generated_at: '2026-07-01T00:15:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistory', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigest request', async () => {
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest = { run_id: 'run_1', digest_status: 'Complete', digest_reason: 'Diagnostics digest report verdict report history digest history report history digest is complete; patch apply remains unauthorized.', history_status: 'Complete', report_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:16:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigest('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigest', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistory request', async () => {
    const latest_digest = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:16:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest is complete; patch apply remains unauthorized.', digest_count: 1, latest_digest, entries: [latest_digest], apply_authorized: false, generated_at: '2026-07-01T00:17:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistory', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReport request', async () => {
    const latest_digest = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:16:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Diagnostics digest report verdict report history digest history report history digest history report is complete; patch apply remains unauthorized.', history_status: 'Complete', digest_status: 'Complete', digest_count: 1, latest_digest, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:18:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReport('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReport', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory request', async () => {
    const latest_report = { report_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_1', report_status: 'Complete', history_status: 'Complete', digest_status: 'Complete', digest_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:18:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report is complete; patch apply remains unauthorized.', report_count: 1, latest_report, entries: [latest_report], apply_authorized: false, generated_at: '2026-07-01T00:19:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest request', async () => {
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest = { run_id: 'run_1', digest_status: 'Complete', digest_reason: 'Diagnostics digest report verdict report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:20:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory request', async () => {
    const latest_digest = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:20:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', digest_count: 1, latest_digest, entries: [latest_digest], apply_authorized: false, generated_at: '2026-07-01T00:21:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport request', async () => {
    const latest_digest = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:20:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Diagnostics digest report verdict report history digest history report history digest history report history digest history report is complete; patch apply remains unauthorized.', history_status: 'Complete', digest_status: 'Complete', digest_count: 1, latest_digest, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:22:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory request', async () => {
    const latest_report = { report_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_1', report_status: 'Complete', history_status: 'Complete', digest_status: 'Complete', digest_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:22:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report history digest history report is complete; patch apply remains unauthorized.', report_count: 1, latest_report, entries: [latest_report], apply_authorized: false, generated_at: '2026-07-01T00:23:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest request', async () => {
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest = { run_id: 'run_1', digest_status: 'Complete', digest_reason: 'Diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:24:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory request', async () => {
    const latest_digest = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:24:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', digest_count: 1, latest_digest, entries: [latest_digest], apply_authorized: false, generated_at: '2026-07-01T00:25:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport request', async () => {
    const latest_digest = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:24:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report is complete; patch apply remains unauthorized.', history_status: 'Complete', digest_status: 'Complete', digest_count: 1, latest_digest, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:26:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory request', async () => {
    const latest_report = { report_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_1', report_status: 'Complete', history_status: 'Complete', digest_status: 'Complete', digest_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:26:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report is complete; patch apply remains unauthorized.', report_count: 1, latest_report, entries: [latest_report], apply_authorized: false, generated_at: '2026-07-01T00:27:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest request', async () => {
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest = { run_id: 'run_1', digest_status: 'Complete', digest_reason: 'Diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:28:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory request', async () => {
    const latest_digest = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:28:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', digest_count: 1, latest_digest, entries: [latest_digest], apply_authorized: false, generated_at: '2026-07-01T00:29:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport request', async () => {
    const latest_digest = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:28:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report is complete; patch apply remains unauthorized.', history_status: 'Complete', digest_count: 1, latest_digest, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:30:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory request', async () => {
    const latest_report = { report_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_1', report_status: 'Complete', history_status: 'Complete', digest_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:30:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report is complete; patch apply remains unauthorized.', report_count: 1, latest_report, entries: [latest_report], apply_authorized: false, generated_at: '2026-07-01T00:31:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest request', async () => {
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest = { run_id: 'run_1', digest_status: 'Complete', digest_reason: 'Diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:32:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory request', async () => {
    const latest_digest = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:33:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', digest_count: 1, latest_digest, entries: [latest_digest], apply_authorized: false, generated_at: '2026-07-01T00:34:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport request', async () => {
    const latest_digest = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:33:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history report is complete; patch apply remains unauthorized.', history_status: 'Complete', digest_count: 1, latest_digest, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:35:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory request', async () => {
    const latest_report = { report_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_1', report_status: 'Complete', history_status: 'Complete', digest_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:36:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history report is complete; patch apply remains unauthorized.', report_count: 1, latest_report, entries: [latest_report], apply_authorized: false, generated_at: '2026-07-01T00:37:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest request', async () => {
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest = { run_id: 'run_1', digest_status: 'Complete', digest_reason: 'Diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:38:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest', params: { run_id: 'run_1' } }]);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory request', async () => {
    const latest_digest = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:39:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history = { run_id: 'run_1', history_status: 'Complete', history_reason: 'Latest diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history report history digest is complete; patch apply remains unauthorized.', digest_count: 1, latest_digest, entries: [latest_digest], apply_authorized: false, generated_at: '2026-07-01T00:40:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory', params: { run_id: 'run_1' } }]);
  });

  it('validates proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport results', () => {
    const latest_digest_phase_3_50 = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:40:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Diagnostics report is complete; patch apply remains unauthorized.', history_status: 'Complete', digest_count: 1, latest_digest: latest_digest_phase_3_50, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:41:00Z' };
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report, required_next_action_count: 1 } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report, latest_digest: { ...latest_digest_phase_3_50, raw_input: 'raw' } } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: { ...review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report, digest_count: 0, latest_digest: null, proposal_count: 0, complete_count: 0, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0 } })).toBe(true);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport request', async () => {
    const latest_digest = { digest_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_1', digest_status: 'Complete', history_status: 'Complete', report_count: 1, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:40:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report = { run_id: 'run_1', report_status: 'Complete', report_reason: 'Diagnostics report is complete; patch apply remains unauthorized.', history_status: 'Complete', digest_count: 1, latest_digest, proposal_count: 1, complete_count: 1, needs_action_count: 0, blocked_count: 0, failed_check_count: 0, blocked_check_count: 0, required_next_action_count: 0, required_next_actions: [], apply_authorized: false, generated_at: '2026-07-01T00:41:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report } });
    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport', params: { run_id: 'run_1' } }]);
  });

  it('validates proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory results', () => {
    const latest_report_phase_3_51 = { report_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_1', report_status: 'NeedsAction', history_status: 'NeedsAction', digest_count: 1, proposal_count: 2, complete_count: 1, needs_action_count: 1, blocked_count: 0, failed_check_count: 1, blocked_check_count: 0, required_next_action_count: 1, required_next_actions: ['Review diagnostics'], apply_authorized: false, generated_at: '2026-07-01T00:42:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history = { run_id: 'run_1', history_status: 'NeedsAction', history_reason: 'Latest diagnostics report needs operator action; patch apply remains unauthorized.', report_count: 1, latest_report: latest_report_phase_3_51, entries: [latest_report_phase_3_51], apply_authorized: false, generated_at: '2026-07-01T00:43:00Z' };

    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history })).toBe(true);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history, report_count: 2 } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history, apply_authorized: true } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history, latest_report: { ...latest_report_phase_3_51, required_next_action_count: 2 } } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history, entries: [{ ...latest_report_phase_3_51, raw_content: 'raw' }] } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history, latest_report: { ...latest_report_phase_3_51, stdout: 'raw' } } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history, diff: 'raw' } })).toBe(false);
    expect(isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: { ...review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history, report_count: 0, latest_report: null, entries: [] } })).toBe(true);
  });

  it('creates a proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory request', async () => {
    const latest_report_phase_3_51 = { report_id: 'review_queue_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_1', report_status: 'NeedsAction', history_status: 'NeedsAction', digest_count: 1, proposal_count: 2, complete_count: 1, needs_action_count: 1, blocked_count: 0, failed_check_count: 1, blocked_check_count: 0, required_next_action_count: 1, required_next_actions: ['Review diagnostics'], apply_authorized: false, generated_at: '2026-07-01T00:42:00Z' };
    const review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history = { run_id: 'run_1', history_status: 'NeedsAction', history_reason: 'Latest diagnostics report needs operator action; patch apply remains unauthorized.', report_count: 1, latest_report: latest_report_phase_3_51, entries: [latest_report_phase_3_51], apply_authorized: false, generated_at: '2026-07-01T00:43:00Z' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history } });

    await expect(new RuntimeClient(transport).reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory('run_1')).resolves.toEqual({ review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory', params: { run_id: 'run_1' } }]);
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
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: taskListResult });
    const client = new RuntimeClient(transport);

    await expect(client.listTasks()).resolves.toEqual([taskRecord]);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'task.list' }]);
  });

  it('returns task.list progress overview', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: taskListResult });
    const client = new RuntimeClient(transport);

    await expect(client.listTasksWithProgress()).resolves.toEqual(taskListResult);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'task.list' }]);
  });

  it('rejects task.list results without progress overview', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { tasks: [taskRecord] } });
    const client = new RuntimeClient(transport);

    await expect(client.listTasks()).rejects.toThrow('task.list returned an invalid result');
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
