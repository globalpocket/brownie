import { describe, expect, it } from 'vitest';
import { RuntimeJsonRpcError } from '../runtime/errors';
import { isJsonRpcResponse, isLedgerEventSummary, isLlmHealthResult, isLlmStatusResult, isModeSummary, isPermissionCheckResult, isRunInspectSummary, isProposalApplyCapabilityResult, isProposalApproveResult, isProposalPreflightResult, isProposalReadinessResult, isProposalInspectResult, isProposalListResult, isProposalRejectResult, isRuntimeConfigGetResult, isRuntimeDiagnosticsResult, isRuntimeStatusResult, isToolExecuteResult, isToolIntentParseResult, isToolPlanResult, type JsonRpcRequest, type JsonRpcResponse } from '../runtime/protocol';
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
    const capability = { proposal_id: 'proposal_1', capability_id: 'apply_capability_1', capability_status: 'Unavailable', capability_reason: 'Patch apply execution is not enabled in Phase 3.5.', generated_at: '2026-07-01T00:00:00Z', execution_enabled: false, check_count: 2, failed_checks: [], blocked_checks: ['apply_execution_disabled'], checklist: [{ name: 'apply_execution_disabled', status: 'Blocked', reason: 'Patch apply execution is not enabled in Phase 3.5.' }, { name: 'no_raw_content_exposed', status: 'Pass', reason: null }] };
    expect(isProposalApplyCapabilityResult({ proposal: result.proposals[0], capability })).toBe(true);
    expect(isProposalApplyCapabilityResult({ proposal: result.proposals[0], capability: { ...capability, execution_enabled: true } })).toBe(false);
    expect(isProposalApplyCapabilityResult({ proposal: result.proposals[0], capability: { ...capability, raw_input: { patch: 'raw' } } })).toBe(false);
    expect(isProposalApplyCapabilityResult({ proposal: result.proposals[0], capability: { ...capability, checklist: [{ ...capability.checklist[0], diff: 'raw' }] } })).toBe(false);
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
    const capability = { proposal_id: 'proposal_1', capability_id: 'apply_capability_1', capability_status: 'Unavailable', capability_reason: 'Patch apply execution is not enabled in Phase 3.5.', generated_at: '2026-07-01T00:00:00Z', execution_enabled: false, check_count: 1, failed_checks: [], blocked_checks: ['apply_execution_disabled'], checklist: [{ name: 'apply_execution_disabled', status: 'Blocked', reason: 'Patch apply execution is not enabled in Phase 3.5.' }] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { proposal, capability } });
    await expect(new RuntimeClient(transport).inspectApplyCapability('run_1', 'proposal_1')).resolves.toEqual({ proposal, capability });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'proposal.applyCapability', params: { run_id: 'run_1', proposal_id: 'proposal_1' } }]);
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
