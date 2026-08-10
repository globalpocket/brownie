import { RuntimeJsonRpcError, RuntimeProtocolError } from './errors';
import type { ProposalApplyResult, ProposalPatchHunk } from './protocol';
import type { CodebaseIndexSelectionReadResult, TaskRunParams } from './protocol';
import type { HeadlessContinueOnceParams, HeadlessContinueOnceResult } from './protocol';
import type { HeadlessRunAdvanceParams, HeadlessRunAdvanceResult, HeadlessRunDriveParams, HeadlessRunDriveResult } from './protocol';
import type { ModePackActivateResult, ModePackApproveCandidateResult, ModePackFetchCandidateResult, ModePackReplaceActiveResult, ModePackRollbackActiveResult, ModePackVerifyCandidateProvenanceResult } from './protocol';
import { isProposalApplyResult } from './protocol';
import type { TaskListResult } from './protocol';
import { isHeadlessContinueOnceResult, isTaskListResult } from './protocol';
import { isHeadlessRunAdvanceResult, isHeadlessRunDriveResult } from './protocol';
import { isModePackActivateResult, isModePackApproveCandidateResult, isModePackFetchCandidateResult, isModePackReplaceActiveResult, isModePackRollbackActiveResult, isModePackVerifyCandidateProvenanceResult } from './protocol';
import type { JsonRpcRequest, LlmHealthResult, LlmStatusResult, RuntimeConfigGetResult, RuntimeDiagnosticsResult, ModeSummary, PermissionCheckResult, RuntimeActionName, RuntimeStatusResult, RunEventsResult, RunInspectResult, RunInspectSummary, ProposalApplyCapabilityResult, ProposalApplyDryRunHistoryResult, ProposalApplyDryRunResult, ProposalApproveResult, ProposalAuditTrailResult, ProposalPreflightResult, ProposalReadinessResult, ProposalInspectResult, ProposalListResult, ProposalRejectResult, ProposalReviewBundleResult, ProposalReviewQueueDiagnosticsDigestHistoryResult, ProposalReviewQueueDiagnosticsDigestReportHistoryResult, ProposalReviewQueueDiagnosticsDigestReportResult, ProposalReviewQueueDiagnosticsDigestReportVerdictHistoryResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryResult, ProposalReviewQueueDiagnosticsDigestReportVerdictReportResult, ProposalReviewQueueDiagnosticsDigestReportVerdictResult, ProposalReviewQueueDiagnosticsDigestResult, ProposalReviewQueueDiagnosticsHistoryResult, ProposalReviewQueueDiagnosticsReportResult, ProposalReviewQueueDiagnosticsResult, ProposalReviewQueueResult, ProposalReviewReportResult, ProposalReviewVerdictResult, TaskInspectResult, TaskRecord, TaskRunResult, ToolExecuteResult, ToolIntentParseResult, ToolPlanResult, TaskStartParams, TaskStartResult } from './protocol';
import type { ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult } from './protocol';
import type { ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult } from './protocol';
import type { ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult } from './protocol';
import type { ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult } from './protocol';
import type { ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult } from './protocol';
import type { ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult } from './protocol';
import type { ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult } from './protocol';
import type { ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult } from './protocol';
import { isLlmHealthResult, isLlmStatusResult, isRuntimeConfigGetResult, isRuntimeDiagnosticsResult, isModeListResult, isModeSummary, isPermissionCheckResult, isProposalApplyCapabilityResult, isProposalApplyDryRunHistoryResult, isProposalApplyDryRunResult, isProposalApproveResult, isProposalAuditTrailResult, isProposalPreflightResult, isProposalReadinessResult, isProposalInspectResult, isProposalListResult, isProposalRejectResult, isProposalReviewBundleResult, isProposalReviewQueueDiagnosticsDigestHistoryResult, isProposalReviewQueueDiagnosticsDigestReportHistoryResult, isProposalReviewQueueDiagnosticsDigestReportResult, isProposalReviewQueueDiagnosticsDigestReportVerdictHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryResult, isProposalReviewQueueDiagnosticsDigestReportVerdictReportResult, isProposalReviewQueueDiagnosticsDigestReportVerdictResult, isProposalReviewQueueDiagnosticsDigestResult, isProposalReviewQueueDiagnosticsHistoryResult, isProposalReviewQueueDiagnosticsReportResult, isProposalReviewQueueDiagnosticsResult, isProposalReviewQueueResult, isProposalReviewReportResult, isProposalReviewVerdictResult, isRunEventsResult, isRunInspectResult, isRuntimeStatusResult, isTaskInspectResult, isTaskRecord, isTaskRunResult, isToolExecuteResult, isToolIntentParseResult, isToolPlanResult, isTaskStartResult } from './protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult } from './protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult } from './protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult } from './protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult } from './protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult } from './protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult } from './protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult } from './protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult } from './protocol';
import type { ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult } from './protocol';
import type { ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult } from './protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult } from './protocol';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult } from './protocol';
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

  async activateModePack(authorize: boolean): Promise<ModePackActivateResult> {
    const result = await this.call<ModePackActivateResult>('modepack.activate', { authorize });

    if (!isModePackActivateResult(result)) {
      throw new RuntimeProtocolError('modepack.activate returned an invalid result');
    }

    return result;
  }

  async fetchModePackCandidate(authorizeFetch: boolean, url: string, expectedContentSha256?: string | null): Promise<ModePackFetchCandidateResult> {
    const result = await this.call<ModePackFetchCandidateResult>('modepack.fetchCandidate', {
      authorize_fetch: authorizeFetch,
      url,
      expected_content_sha256: expectedContentSha256 ?? null,
    });

    if (!isModePackFetchCandidateResult(result)) {
      throw new RuntimeProtocolError('modepack.fetchCandidate returned an invalid result');
    }

    return result;
  }

  async approveModePackCandidate(
    authorizeTrust: boolean,
    expectedContentSha256: string,
    expectedCompiledPolicyFingerprint: string,
    expectedProvenanceId: string,
    expectedProvenanceEventId: string,
    expectedSignerFingerprint: string,
    expectedStatementSha256: string,
  ): Promise<ModePackApproveCandidateResult> {
    const result = await this.call<ModePackApproveCandidateResult>('modepack.approveCandidate', {
      authorize_trust: authorizeTrust,
      expected_content_sha256: expectedContentSha256,
      expected_compiled_policy_fingerprint: expectedCompiledPolicyFingerprint,
      expected_provenance_id: expectedProvenanceId,
      expected_provenance_event_id: expectedProvenanceEventId,
      expected_signer_fingerprint: expectedSignerFingerprint,
      expected_statement_sha256: expectedStatementSha256,
    });

    if (!isModePackApproveCandidateResult(result)) {
      throw new RuntimeProtocolError('modepack.approveCandidate returned an invalid result');
    }

    return result;
  }

  async verifyModePackCandidateProvenance(params: {
    authorizeProvenanceVerification: boolean;
    expectedContentSha256: string;
    expectedCompiledPolicyFingerprint: string;
    expectedSignerFingerprint: string;
    provenanceStatementJson: string;
    provenanceSignatureBase64: string;
    provenancePublicKeyBase64: string;
  }): Promise<ModePackVerifyCandidateProvenanceResult> {
    const result = await this.call<ModePackVerifyCandidateProvenanceResult>('modepack.verifyCandidateProvenance', {
      authorize_provenance_verification: params.authorizeProvenanceVerification,
      expected_content_sha256: params.expectedContentSha256,
      expected_compiled_policy_fingerprint: params.expectedCompiledPolicyFingerprint,
      expected_signer_fingerprint: params.expectedSignerFingerprint,
      provenance_statement_json: params.provenanceStatementJson,
      provenance_signature_base64: params.provenanceSignatureBase64,
      provenance_public_key_base64: params.provenancePublicKeyBase64,
    });

    if (!isModePackVerifyCandidateProvenanceResult(result)) {
      throw new RuntimeProtocolError('modepack.verifyCandidateProvenance returned an invalid result');
    }

    return result;
  }

  async replaceActiveModePack(
    authorizeReplacement: boolean,
    expectedCurrentActivationFingerprint: string,
    expectedCandidateActivationFingerprint: string,
    approvedCandidate?: {
      approvalId: string;
      contentSha256: string;
      compiledPolicyFingerprint: string;
    } | null
  ): Promise<ModePackReplaceActiveResult> {
    const params: Record<string, unknown> = {
      authorize_replacement: authorizeReplacement,
      expected_current_activation_fingerprint: expectedCurrentActivationFingerprint,
      expected_candidate_activation_fingerprint: expectedCandidateActivationFingerprint,
    };
    if (approvedCandidate) {
      params.approved_candidate_approval_id = approvedCandidate.approvalId;
      params.expected_approved_candidate_content_sha256 = approvedCandidate.contentSha256;
      params.expected_approved_candidate_compiled_policy_fingerprint = approvedCandidate.compiledPolicyFingerprint;
    }
    const result = await this.call<ModePackReplaceActiveResult>('modepack.replaceActive', params);

    if (!isModePackReplaceActiveResult(result)) {
      throw new RuntimeProtocolError('modepack.replaceActive returned an invalid result');
    }

    return result;
  }

  async rollbackActiveModePack(authorizeRollback: boolean, expectedCurrentActivationFingerprint: string, expectedRollbackActivationFingerprint: string): Promise<ModePackRollbackActiveResult> {
    const result = await this.call<ModePackRollbackActiveResult>('modepack.rollbackActive', {
      authorize_rollback: authorizeRollback,
      expected_current_activation_fingerprint: expectedCurrentActivationFingerprint,
      expected_rollback_activation_fingerprint: expectedRollbackActivationFingerprint,
    });

    if (!isModePackRollbackActiveResult(result)) {
      throw new RuntimeProtocolError('modepack.rollbackActive returned an invalid result');
    }

    return result;
  }

  async startTask(params: TaskStartParams): Promise<TaskStartResult> {
    const requestParams: {
      goal: string;
      mode_id?: string;
      verification_recovery_source?: unknown;
      patch_apply_recovery_source?: unknown;
    } = {
      goal: params.goal,
    };
    if (params.modeId !== undefined) {
      requestParams.mode_id = params.modeId;
    }
    if (params.verificationRecoverySource !== undefined) {
      requestParams.verification_recovery_source = params.verificationRecoverySource;
    }
    if (params.patchApplyRecoverySource !== undefined) {
      requestParams.patch_apply_recovery_source = params.patchApplyRecoverySource;
    }
    const result = await this.call<TaskStartResult>('task.start', requestParams);

    if (!isTaskStartResult(result)) {
      throw new RuntimeProtocolError('task.start returned an invalid result');
    }

    return result;
  }

  async runTask(taskId: string, selectedIndexContext?: CodebaseIndexSelectionReadResult | null): Promise<TaskRunResult> {
    const requestParams: TaskRunParams = { task_id: taskId };
    if (selectedIndexContext !== undefined && selectedIndexContext !== null) {
      requestParams.selected_index_context = selectedIndexContext;
    }
    const result = await this.call<TaskRunResult>('task.run', requestParams);

    if (!isTaskRunResult(result)) {
      throw new RuntimeProtocolError('task.run returned an invalid result');
    }

    return result;
  }

  async continueOnceHeadless(params: HeadlessContinueOnceParams): Promise<HeadlessContinueOnceResult> {
    const result = await this.call<HeadlessContinueOnceResult>('headless.continue_once', params);

    if (!isHeadlessContinueOnceResult(result)) {
      throw new RuntimeProtocolError('headless.continue_once returned an invalid result');
    }

    return result;
  }

  async advanceHeadlessRun(params: HeadlessRunAdvanceParams): Promise<HeadlessRunAdvanceResult> {
    const result = await this.call<HeadlessRunAdvanceResult>('headless.run.advance', params);

    if (!isHeadlessRunAdvanceResult(result)) {
      throw new RuntimeProtocolError('headless.run.advance returned an invalid result');
    }

    return result;
  }

  async driveHeadlessRun(params: HeadlessRunDriveParams): Promise<HeadlessRunDriveResult> {
    const result = await this.call<HeadlessRunDriveResult>('headless.run.drive', params);

    if (!isHeadlessRunDriveResult(result)) {
      throw new RuntimeProtocolError('headless.run.drive returned an invalid result');
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

  async applyProposal(runId: string, proposalId: string, expectedTargetSha256: string, replacementContent: string, authorize = true): Promise<ProposalApplyResult> {
    const result = await this.call<ProposalApplyResult>('proposal.apply', { run_id: runId, proposal_id: proposalId, expected_target_sha256: expectedTargetSha256, replacement_content: replacementContent, authorize });

    if (!isProposalApplyResult(result)) {
      throw new RuntimeProtocolError('proposal.apply returned an invalid result');
    }

    return result;
  }

  async applyPatchFileProposal(runId: string, proposalId: string, expectedTargetSha256: string, patchHunks: ProposalPatchHunk[], authorize = true): Promise<ProposalApplyResult> {
    const result = await this.call<ProposalApplyResult>('proposal.apply', { run_id: runId, proposal_id: proposalId, expected_target_sha256: expectedTargetSha256, patch_hunks: patchHunks, authorize });

    if (!isProposalApplyResult(result)) {
      throw new RuntimeProtocolError('proposal.apply returned an invalid patch_file result');
    }

    return result;
  }

  async applyReplaceFileTransaction(runId: string, transactionItems: Array<{ proposal_id: string; expected_target_sha256: string; replacement_content: string }>, authorize = true): Promise<ProposalApplyResult> {
    const result = await this.call<ProposalApplyResult>('proposal.apply', { run_id: runId, proposal_id: transactionItems[0]?.proposal_id ?? '', transaction_items: transactionItems, authorize });

    if (!isProposalApplyResult(result)) {
      throw new RuntimeProtocolError('proposal.apply returned an invalid transaction result');
    }

    return result;
  }

  async applyCreateFileTransaction(runId: string, transactionItems: Array<{ proposal_id: string; expected_target_absent: true; replacement_content: string }>, authorize = true): Promise<ProposalApplyResult> {
    const result = await this.call<ProposalApplyResult>('proposal.apply', { run_id: runId, proposal_id: transactionItems[0]?.proposal_id ?? '', transaction_items: transactionItems, authorize });

    if (!isProposalApplyResult(result)) {
      throw new RuntimeProtocolError('proposal.apply returned an invalid create_file transaction result');
    }

    return result;
  }

  async applyCreateFileProposal(runId: string, proposalId: string, content: string, authorize = true): Promise<ProposalApplyResult> {
    const result = await this.call<ProposalApplyResult>('proposal.apply', { run_id: runId, proposal_id: proposalId, expected_target_absent: true, replacement_content: content, authorize });

    if (!isProposalApplyResult(result)) {
      throw new RuntimeProtocolError('proposal.apply returned an invalid create_file result');
    }

    return result;
  }

  async applyDeleteFileProposal(runId: string, proposalId: string, expectedTargetSha256: string, authorize = true): Promise<ProposalApplyResult> {
    const result = await this.call<ProposalApplyResult>('proposal.apply', { run_id: runId, proposal_id: proposalId, expected_target_sha256: expectedTargetSha256, authorize });

    if (!isProposalApplyResult(result)) {
      throw new RuntimeProtocolError('proposal.apply returned an invalid delete_file result');
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

  async reviewQueueDiagnosticsDigestReportVerdictHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictHistoryResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictHistory returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReport(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReport', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReport returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistory returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigest(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigest', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigest returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistory returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReport(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReport', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReport returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistory returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigest(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigest', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigest returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistory returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReport(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReport', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReport returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport returned an invalid result');
    }

    return result;
  }

  async reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory(runId: string): Promise<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult> {
    const result = await this.call<ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult>('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory', { run_id: runId });

    if (!isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult(result)) {
      throw new RuntimeProtocolError('proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory returned an invalid result');
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
    return (await this.listTasksWithProgress()).tasks;
  }

  async listTasksWithProgress(): Promise<TaskListResult> {
    const result = await this.call<unknown>('task.list');

    if (!isTaskListResult(result)) {
      throw new RuntimeProtocolError('task.list returned an invalid result');
    }

    return result;
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
