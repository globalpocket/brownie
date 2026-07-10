import { RuntimeJsonRpcError, RuntimeProtocolError } from './errors';
import type { JsonRpcRequest, LlmHealthResult, LlmStatusResult, RuntimeConfigGetResult, RuntimeDiagnosticsResult, ModeSummary, PermissionCheckResult, RuntimeActionName, RuntimeStatusResult, RunEventsResult, RunInspectResult, RunInspectSummary, ProposalApplyCapabilityResult, ProposalApplyDryRunHistoryResult, ProposalApplyDryRunResult, ProposalApproveResult, ProposalAuditTrailResult, ProposalPreflightResult, ProposalReadinessResult, ProposalInspectResult, ProposalListResult, ProposalRejectResult, ProposalReviewBundleResult, ProposalReviewQueueDiagnosticsDigestHistoryResult, ProposalReviewQueueDiagnosticsDigestReportHistoryResult, ProposalReviewQueueDiagnosticsDigestReportResult, ProposalReviewQueueDiagnosticsDigestReportVerdictResult, ProposalReviewQueueDiagnosticsDigestResult, ProposalReviewQueueDiagnosticsHistoryResult, ProposalReviewQueueDiagnosticsReportResult, ProposalReviewQueueDiagnosticsResult, ProposalReviewQueueResult, ProposalReviewReportResult, ProposalReviewVerdictResult, TaskInspectResult, TaskRecord, TaskRunResult, ToolExecuteResult, ToolIntentParseResult, ToolPlanResult, TaskStartParams, TaskStartResult } from './protocol';
import { isLlmHealthResult, isLlmStatusResult, isRuntimeConfigGetResult, isRuntimeDiagnosticsResult, isModeListResult, isModeSummary, isPermissionCheckResult, isProposalApplyCapabilityResult, isProposalApplyDryRunHistoryResult, isProposalApplyDryRunResult, isProposalApproveResult, isProposalAuditTrailResult, isProposalPreflightResult, isProposalReadinessResult, isProposalInspectResult, isProposalListResult, isProposalRejectResult, isProposalReviewBundleResult, isProposalReviewQueueDiagnosticsDigestHistoryResult, isProposalReviewQueueDiagnosticsDigestReportHistoryResult, isProposalReviewQueueDiagnosticsDigestReportResult, isProposalReviewQueueDiagnosticsDigestReportVerdictResult, isProposalReviewQueueDiagnosticsDigestResult, isProposalReviewQueueDiagnosticsHistoryResult, isProposalReviewQueueDiagnosticsReportResult, isProposalReviewQueueDiagnosticsResult, isProposalReviewQueueResult, isProposalReviewReportResult, isProposalReviewVerdictResult, isRunEventsResult, isRunInspectResult, isRuntimeStatusResult, isTaskInspectResult, isTaskRecord, isTaskRunResult, isToolExecuteResult, isToolIntentParseResult, isToolPlanResult, isTaskStartResult } from './protocol';
import type { RuntimeTransport } from './runtimeProcess';

const DEFAULT_TIMEOUT_MS = 10_000;

export class RuntimeClient {
  private nextId = 1;

  constructor(
    private readonly transport: RuntimeTransport,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async status(): Promise<RuntimeStatusResult> {
    const result = await this.call<RuntimeStatusResult>('runtime.status');

    if (!isRuntimeStatusResult(result)) {
      throw new RuntimeProtocolError('runtime.status returned an invalid result');
    }

    return result;
  }

  async llmStatus(): Promise<LlmStatusResult> {
    const result = await this.call<LlmStatusResult>('llm.status');

    if (!isLlmStatusResult(result)) {
      throw new RuntimeProtocolError('llm.status returned an invalid result');
    }

    return result;
  }

  async runtimeDiagnostics(): Promise<RuntimeDiagnosticsResult> {
    const result = await this.call<RuntimeDiagnosticsResult>('runtime.diagnostics.get');

    if (!isRuntimeDiagnosticsResult(result)) {
      throw new RuntimeProtocolError('runtime.diagnostics.get returned an invalid result');
    }

    return result;
  }

  async llmHealth(params: { allow_network: boolean; timeout_ms?: number }): Promise<LlmHealthResult> {
    const result = await this.call<LlmHealthResult>('llm.health', params);

    if (!isLlmHealthResult(result)) {
      throw new RuntimeProtocolError('llm.health returned an invalid result');
    }

    return result;
  }

  async runtimeConfig(): Promise<RuntimeConfigGetResult> {
    const result = await this.call<RuntimeConfigGetResult>('runtime.config.get');

    if (!isRuntimeConfigGetResult(result)) {
      throw new RuntimeProtocolError('runtime.config.get returned an invalid result');
    }

    return result;
  }

  async listModes(): Promise<ModeSummary[]> {
    const result = await this.call<{ modes: unknown }>('mode.list');

    if (!isModeListResult(result)) {
      throw new RuntimeProtocolError('mode.list returned an invalid result');
    }

    return result.modes;
  }

  async getMode(modeId: string): Promise<ModeSummary> {
    const result = await this.call<ModeSummary>('mode.get', { mode_id: modeId });

    if (!isModeSummary(result)) {
      throw new RuntimeProtocolError('mode.get returned an invalid result');
    }

    return result;
  }

  async checkPermission(modeId: string, action: RuntimeActionName): Promise<PermissionCheckResult> {
    const result = await this.call<PermissionCheckResult>('permission.check', {
      mode_id: modeId,
      action,
    });

    if (!isPermissionCheckResult(result)) {
      throw new RuntimeProtocolError('permission.check returned an invalid result');
    }

    return result;
  }

  async startTask(params: TaskStartParams): Promise<TaskStartResult> {
    const result = await this.call<TaskStartResult>('task.start', {
      goal: params.goal,
      mode_id: params.modeId,
    });

    if (!isTaskStartResult(result)) {
      throw new RuntimeProtocolError('task.start returned an invalid result');
    }

    return result;
  }

  async runTask(taskId: string): Promise<TaskRunResult> {
    const result = await this.call<TaskRunResult>('task.run', { task_id: taskId });

    if (!isTaskRunResult(result)) {
      throw new RuntimeProtocolError('task.run returned an invalid result');
    }

    return result;
  }

  async getRunEvents(runId: string): Promise<RunEventsResult> {
    const result = await this.call<RunEventsResult>('run.events', { run_id: runId });

    if (!isRunEventsResult(result)) {
      throw new RuntimeProtocolError('run.events returned an invalid result');
    }

    return result;
  }

  async inspectRun(runId: string): Promise<RunInspectSummary> {
    const result = await this.call<RunInspectResult>('run.inspect', { run_id: runId });

    if (!isRunInspectResult(result)) {
      throw new RuntimeProtocolError('run.inspect returned an invalid result');
    }

    return result.run;
  }

  async listProposals(runId: string): Promise<ProposalListResult> {
    const result = await this.call<ProposalListResult>('proposal.list', { run_id: runId });

    if (!isProposalListResult(result)) {
      throw new RuntimeProtocolError('proposal.list returned an invalid result');
    }

    return result;
  }

  async inspectProposal(runId: string, proposalId: string): Promise<ProposalInspectResult> {
    const result = await this.call<ProposalInspectResult>('proposal.inspect', { run_id: runId, proposal_id: proposalId });

    if (!isProposalInspectResult(result)) {
      throw new RuntimeProtocolError('proposal.inspect returned an invalid result');
    }

    return result;
  }

  async approveProposal(runId: string, proposalId: string, reason?: string): Promise<ProposalApproveResult> {
    const result = await this.call<ProposalApproveResult>('proposal.approve', { run_id: runId, proposal_id: proposalId, reason: reason ?? null });

    if (!isProposalApproveResult(result)) {
      throw new RuntimeProtocolError('proposal.approve returned an invalid result');
    }

    return result;
  }

  async preflightProposal(runId: string, proposalId: string): Promise<ProposalPreflightResult> {
    const result = await this.call<ProposalPreflightResult>('proposal.preflight', { run_id: runId, proposal_id: proposalId });

    if (!isProposalPreflightResult(result)) {
      throw new RuntimeProtocolError('proposal.preflight returned an invalid result');
    }

    return result;
  }

  async readinessProposal(runId: string, proposalId: string): Promise<ProposalReadinessResult> {
    const result = await this.call<ProposalReadinessResult>('proposal.readiness', { run_id: runId, proposal_id: proposalId });

    if (!isProposalReadinessResult(result)) {
      throw new RuntimeProtocolError('proposal.readiness returned an invalid result');
    }

    return result;
  }

  async inspectApplyCapability(runId: string, proposalId: string): Promise<ProposalApplyCapabilityResult> {
    const result = await this.call<ProposalApplyCapabilityResult>('proposal.applyCapability', { run_id: runId, proposal_id: proposalId });

    if (!isProposalApplyCapabilityResult(result)) {
      throw new RuntimeProtocolError('proposal.applyCapability returned an invalid result');
    }

    return result;
  }

  async applyDryRun(runId: string, proposalId: string): Promise<ProposalApplyDryRunResult> {
    const result = await this.call<ProposalApplyDryRunResult>('proposal.applyDryRun', { run_id: runId, proposal_id: proposalId });

    if (!isProposalApplyDryRunResult(result)) {
      throw new RuntimeProtocolError('proposal.applyDryRun returned an invalid result');
    }

    return result;
  }

  async applyDryRunHistory(runId: string, proposalId: string): Promise<ProposalApplyDryRunHistoryResult> {
    const result = await this.call<ProposalApplyDryRunHistoryResult>('proposal.applyDryRunHistory', { run_id: runId, proposal_id: proposalId });

    if (!isProposalApplyDryRunHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.applyDryRunHistory returned an invalid result');
    }

    return result;
  }

  async auditTrail(runId: string, proposalId: string): Promise<ProposalAuditTrailResult> {
    const result = await this.call<ProposalAuditTrailResult>('proposal.auditTrail', { run_id: runId, proposal_id: proposalId });

    if (!isProposalAuditTrailResult(result)) {
      throw new RuntimeProtocolError('proposal.auditTrail returned an invalid result');
    }

    return result;
  }

  async reviewBundle(runId: string, proposalId: string): Promise<ProposalReviewBundleResult> {
    const result = await this.call<ProposalReviewBundleResult>('proposal.reviewBundle', { run_id: runId, proposal_id: proposalId });

    if (!isProposalReviewBundleResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewBundle returned an invalid result');
    }

    return result;
  }

  async reviewVerdict(runId: string, proposalId: string): Promise<ProposalReviewVerdictResult> {
    const result = await this.call<ProposalReviewVerdictResult>('proposal.reviewVerdict', { run_id: runId, proposal_id: proposalId });

    if (!isProposalReviewVerdictResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewVerdict returned an invalid result');
    }

    return result;
  }

  async reviewReport(runId: string, proposalId: string): Promise<ProposalReviewReportResult> {
    const result = await this.call<ProposalReviewReportResult>('proposal.reviewReport', { run_id: runId, proposal_id: proposalId });

    if (!isProposalReviewReportResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewReport returned an invalid result');
    }

    return result;
  }

  async reviewQueue(runId: string): Promise<ProposalReviewQueueResult> {
    const result = await this.call<ProposalReviewQueueResult>('proposal.reviewQueue', { run_id: runId });

    if (!isProposalReviewQueueResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueue returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnostics(runId: string): Promise<ProposalReviewQueueDiagnosticsResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsResult>('proposal.reviewQueueDiagnostics', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnostics returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsHistoryResult>('proposal.reviewQueueDiagnosticsHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsHistory returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsReport(runId: string): Promise<ProposalReviewQueueDiagnosticsReportResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsReportResult>('proposal.reviewQueueDiagnosticsReport', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsReportResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsReport returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigest(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestResult>('proposal.reviewQueueDiagnosticsDigest', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigest returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestHistoryResult>('proposal.reviewQueueDiagnosticsDigestHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestHistory returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReport(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportResult>('proposal.reviewQueueDiagnosticsDigestReport', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReport returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportHistoryResult>('proposal.reviewQueueDiagnosticsDigestReportHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportHistory returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdict(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictResult>('proposal.reviewQueueDiagnosticsDigestReportVerdict', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdict returned an invalid result');
    }

    return result;
  }

  async rejectProposal(runId: string, proposalId: string, reason?: string): Promise<ProposalRejectResult> {
    const result = await this.call<ProposalRejectResult>('proposal.reject', { run_id: runId, proposal_id: proposalId, reason: reason ?? null });

    if (!isProposalRejectResult(result)) {
      throw new RuntimeProtocolError('proposal.reject returned an invalid result');
    }

    return result;
  }

  async inspectTask(taskId: string): Promise<TaskInspectResult> {
    const result = await this.call<TaskInspectResult>('task.inspect', { task_id: taskId });

    if (!isTaskInspectResult(result)) {
      throw new RuntimeProtocolError('task.inspect returned an invalid result');
    }

    return result;
  }

  async parseToolIntent(modeId: string, assistantContent: string): Promise<ToolIntentParseResult> {
    const result = await this.call<ToolIntentParseResult>('tool.intent.parse', {
      mode_id: modeId,
      assistant_content: assistantContent,
    });

    if (!isToolIntentParseResult(result)) {
      throw new RuntimeProtocolError('tool.intent.parse returned an invalid result');
    }

    return result;
  }

  async planTools(taskId: string): Promise<ToolPlanResult> {
    const result = await this.call<ToolPlanResult>('tool.plan', { task_id: taskId });

    if (!isToolPlanResult(result)) {
      throw new RuntimeProtocolError('tool.plan returned an invalid result');
    }

    return result;
  }

  async executeTool(modeId: string, toolId: string, input: unknown): Promise<ToolExecuteResult> {
    const result = await this.call<ToolExecuteResult>('tool.execute', {
      mode_id: modeId,
      tool_id: toolId,
      input,
    });

    if (!isToolExecuteResult(result)) {
      throw new RuntimeProtocolError('tool.execute returned an invalid result');
    }

    return result;
  }

  async getTask(taskId: string): Promise<TaskRecord> {
    const result = await this.call<TaskRecord>('task.get', { task_id: taskId });

    if (!isTaskRecord(result)) {
      throw new RuntimeProtocolError('task.get returned an invalid result');
    }

    return result;
  }

  async listTasks(): Promise<TaskRecord[]> {
    const result = await this.call<{ tasks: unknown }>('task.list');

    if (!isTaskListResult(result)) {
      throw new RuntimeProtocolError('task.list returned an invalid result');
    }

    return result.tasks;
  }

  private async call<T>(method: string, params?: unknown): Promise<T> {
    const response = await this.send<T>(method, params);

    if (response.error !== undefined) {
      throw new RuntimeJsonRpcError(response.error);
    }

    return response.result as T;
  }

  private send<T>(method: string, params?: unknown) {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId,
      method,
    };
    this.nextId += 1;

    if (params !== undefined) {
      request.params = params;
    }

    return this.transport.request<T>(request, this.timeoutMs);
  }
}

function isTaskListResult(value: unknown): value is { tasks: TaskRecord[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { tasks?: unknown }).tasks) &&
    (value as { tasks: unknown[] }).tasks.every(isTaskRecord)
  );
}
