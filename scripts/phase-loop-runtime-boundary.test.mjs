import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const controller = fs.readFileSync(path.join(repoRoot, 'phase-loop.sh'), 'utf8');

function mismatchRecoveryBlock() {
  const start = controller.indexOf('if [ "$runtime_admission_status" -ne 0 ]; then');
  const end = controller.indexOf('  bind_runtime_stdout_to_active_claim "$stdout_log"', start);
  assert(start >= 0 && end > start, 'runtime admission mismatch recovery block must exist');
  return controller.slice(start, end);
}

test('runtime mismatch recovery restores delegated scope, target, and pre-runtime claim snapshots', () => {
  const block = mismatchRecoveryBlock();
  assert.match(block, /phase-loop-delegated-scope\.mjs/);
  assert.match(block, /active_target_snapshots/);
  assert.match(block, /restore_pre_runtime_active_target_snapshots \"\$active_target_snapshots\"/);
  assert.match(block, /restore_claim_snapshot_before_runtime \"\$claim_snapshot_before_runtime\"/);
  assert.doesNotMatch(block, /\n\s+write_todo_claim\b/);
});

test('public blocked-event canonicalization preserves owner stops without contradictory continuation', () => {
  assert.match(controller, /reason in \{\"explicit_blocker\", \"explicit_blocker_pre_runtime\"\}/);
  assert.match(controller, /payload\.get\("owner_blocked"\) is True/);
  assert.match(controller, /payload\[\"owner_blocked\"\] = True/);
  assert.match(controller, /payload\.pop\("continuation_required", None\)/);
});

test('controller stops repeated stale continuation scopes before a third blind resume', () => {
  assert.match(controller, /stale_continuation_scope_exhausted = \(/);
  assert.match(controller, /progress_projection\["cli_status"\] == "stale_progress"/);
  assert.match(controller, /int\(progress_projection\.get\("candidate_count"\) or 0\) == 0/);
  assert.match(controller, /same_count >= 2/);
  assert.match(controller, /if stale_continuation_scope_exhausted:\n    continuation_required = False/);
  assert.match(controller, /progress_projection\["stale_continuation_scope_exhausted"\] = stale_continuation_scope_exhausted/);
  assert.match(controller, /"candidate_count": count\(payload\.get\("candidate_count"\)\)/);
  assert.match(controller, /"headless_root_run_id": text\(payload\.get\("headless_root_run_id"\)\)/);
  assert.match(controller, /"headless_selected_run_id": text\(payload\.get\("headless_selected_run_id"\)\)/);
});

test('pending claims with zero runtime candidates are terminal even when legacy resume omits blocked', () => {
  assert.match(controller, /Runtime's legacy resume projection can report zero candidates with\n    # blocked=false even though an immutable pending claim was supplied/);
  assert.match(controller, /bool\(progress_projection\["claim_id"\]\)/);
  assert.match(controller, /bool\(progress_projection\["selected_todo"\]\)/);
  assert.match(controller, /int\(progress_projection\["candidate_count"\] or 0\) == 0/);
  assert.match(controller, /progress_projection\["cli_status"\] in \("no_eligible_task", "no_actionable_work"\)/);
  assert.match(controller, /progress_projection\["cli_status"\] == "no_actionable_work"/);
  assert.match(controller, /progress_projection\["stop_class"\] == "no_actionable_work"/);
  assert.match(controller, /progress_projection\["controller_action"\] == "stop"/);
  assert.match(controller, /classification = \(\n    "terminal_failure"\n    if terminal_non_progress/);
});

test('a task-executed terminal-evidence gap cannot be recorded as an external blocked TODO', () => {
  const marker = 'terminal_completion_evidence_missing_without_objective_apply = (';
  const classification = controller.indexOf(marker);
  const externalBoundaryDetail = controller.indexOf(
    'Brownie run reached a blocked external-control boundary',
  );
  const terminalBranch = controller.indexOf('case "$progress_classification"');
  assert.ok(
    classification >= 0 && externalBoundaryDetail > classification && terminalBranch > externalBoundaryDetail,
    'terminal-evidence gaps must be classified before either blocked-boundary return and then reach terminal recovery',
  );

  const externalBoundaryStart = controller.lastIndexOf('elif python3 - "$stdout_log"', externalBoundaryDetail);
  const externalBoundary = controller.slice(externalBoundaryStart, externalBoundaryDetail);
  assert.match(externalBoundary, /stop_reason == "terminal_completion_evidence_missing"/);
  assert.match(externalBoundary, /and not objective_apply_applied/);
  assert.match(externalBoundary, /sys\.exit\(1\)/);
  assert.match(
    controller,
    /\) or terminal_completion_evidence_missing_without_objective_apply\ncontinuation_required = \(/,
  );
});

test('terminal recovery resolves a rebaselined claim through its immutable selected-TODO snapshot', () => {
  const recoveryStart = controller.indexOf('def admitted_claim_snapshot_for_prior_run(');
  const recoveryEnd = controller.indexOf('def controller_replan_dir()', recoveryStart);
  const recovery = controller.slice(recoveryStart, recoveryEnd);
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart);
  assert.match(recovery, /snapshot_selected != expected_selected/);
  assert.match(recovery, /phase_loop_selected_todo_sha256/);
  assert.match(recovery, /claim_digest = hashlib\.sha256\(run_claim_id\.encode\("utf-8"\)\)\.hexdigest\(\)/);
  assert.match(recovery, /admitted_claim_snapshot_for_prior_run\(/);
  assert.doesNotMatch(recovery, /expected_claim_id/);
  assert.match(
    controller,
    /payload\["phase_loop_selected_todo_sha256"\] = hashlib\.sha256\(selected\.encode\("utf-8"\)\)\.hexdigest\(\)/,
  );
});

test('terminal evidence gaps terminalize the immutable source before any retry-cap recovery', () => {
  const branchStart = controller.indexOf('terminal_completion_evidence_gap_source_terminalized=true');
  const genericRetry = controller.indexOf('terminal_failure_retry_cap_zero_redelegation_required');
  assert(branchStart >= 0 && genericRetry > branchStart, 'source-terminalization must precede generic retry-cap handling');

  const sourceRecovery = controller.slice(
    controller.indexOf('record_terminal_multitarget_replan_transition()'),
    controller.indexOf('\nterminal_multitarget_replan_public_payload()', controller.indexOf('record_terminal_multitarget_replan_transition()')),
  );
  assert.match(sourceRecovery, /evidence\.get\("claim_snapshot_path"\)/);
  assert.match(sourceRecovery, /record-trajectory[^\n]+--type "todo\.failed"/);
  assert.match(sourceRecovery, /record-terminal-replan[^\n]+--claim "\$ledger_claim_path"/);

  const terminalGapBranch = controller.slice(
    controller.lastIndexOf('if python3 - "$PROGRESS_STATE_FILE"', branchStart),
    genericRetry,
  );
  assert.match(terminalGapBranch, /write_bdk_trajectory_event[^\n]+"todo\.blocked"[^\n]+"todo\.failed"/);
  assert.match(terminalGapBranch, /write_todo_claim[^\n]+"failed"/);
  assert.match(terminalGapBranch, /return 76/);

  const fallbackStart = controller.indexOf('if restoring_prior_claim:');
  const fallbackEnd = controller.indexOf('\nfor path, content, suffix in (', fallbackStart);
  assert(fallbackStart >= 0 && fallbackEnd > fallbackStart, 'fallback must restore only a validated canonical claim path');
  const fallback = controller.slice(fallbackStart, fallbackEnd);
  assert.match(fallback, /expected_claim_path = \(claim_root \/ "current\.json"\)\.resolve\(\)/);
  assert.match(fallback, /resolved_claim_path != expected_claim_path/);
  assert.match(controller, /terminal_completion_evidence_missing_without_objective_apply/);
  assert.match(controller, /claim_missing_without_terminal_evidence_gap/);
  assert.match(controller, /"reason":"claim_or_progress_state_missing"/);
});

test('objective-apply replay budget follows the selected TODO across replacement claims', () => {
  assert.match(controller, /objective_apply_target_scope = json\.dumps/);
  assert.match(controller, /same_objective_apply_target_scope = \(/);
  assert.match(controller, /previous_objective_apply_target_replay_count/);
  assert.match(controller, /if not objective_apply_pending:/);
  assert.match(controller, /elif direct_objective_apply_authorization:/);
  assert.match(controller, /A lossy legacy resume is the replay that consumes this bounded budget/);
  assert.match(controller, /objective_apply_target_replay_count >= threshold/);
  assert.match(controller, /same_count >= threshold or objective_apply_target_replay_exhausted/);
  assert.match(controller, /progress_projection\["objective_apply_target_replay_exhausted"\]/);
  assert.match(controller, /objective_apply_terminal_failure = objective_apply_stalled/);
  assert.match(controller, /progress_projection\["objective_apply_terminal_failure"\] = objective_apply_terminal_failure/);
  assert.match(controller, /if terminal_non_progress or objective_apply_terminal_failure/);
  assert.match(controller, /write_bdk_trajectory_event "\$run_stamp" "todo\.repair_feedback" '\{"reason":"terminal_execution_evidence_missing","recovery_state":"redelegatable"\}'/);
  const terminalFeedbackOffset = controller.indexOf('write_bdk_trajectory_event "$run_stamp" "todo.repair_feedback" \'{"reason":"terminal_execution_evidence_missing","recovery_state":"redelegatable"}\'');
  const terminalArchiveOffset = controller.indexOf('run_integrated_supervisor_control "$run_stamp" "terminal_execution_evidence_missing"');
  assert.ok(terminalFeedbackOffset >= 0 && terminalFeedbackOffset < terminalArchiveOffset);
  assert.match(controller, /terminal_missing_evidence_cause="objective_apply_stalled"/);
  assert.match(controller, /reported \$\{terminal_missing_evidence_cause\} without executing the selected task/);
  assert.match(controller, /Target-level replay lineage is supervisory metadata, not Runtime progress/);
  assert.match(controller, /fingerprint_projection\.pop\(target_lineage_field, None\)/);
  assert.match(controller, /target_replay_exhausted_after_claim_replacement = \(/);
  assert.match(controller, /same_count = max\(same_count, threshold\)/);
  assert.match(controller, /existing causeful TODO-contract replan path runs instead of emitting a/);
});

test('controller validates queue integrity before resuming an active claim', () => {
  assert.match(controller, /if phase_loop_should_resume_active_claim; then\n    # Resume is execution/);
  assert.match(controller, /if ! validate_todo_queue_integrity_before_claim "\$run_stamp"; then/);
  assert.match(controller, /todo_queue_integrity_failed_before_resume/);
  assert.match(controller, /write_status "continuation_required" "\$detail" "\$run_id" "\$exit_code" "0" "" "true"/);
  assert.doesNotMatch(controller, /continuation_required\)[\s\S]{0,500}write_status "running"/);
  assert.match(controller, /todo-queue-integrity-resume-\$run_stamp/);
});

test('controller defers only the selected-target integrity finding for a verified Runtime resume continuation', () => {
  const helperStart = controller.indexOf('phase_loop_can_defer_selected_target_change_for_continuation()');
  const helperEnd = controller.indexOf('\ntry_reconstruct_missing_todo_replan_records()', helperStart);
  assert(helperStart >= 0 && helperEnd > helperStart, 'narrow continuation integrity helper must exist');
  const helper = controller.slice(helperStart, helperEnd);
  assert.match(helper, /error\.get\("code"\) != "selected_target_not_changed"/);
  assert.match(helper, /session_artifact_prefixes = \(/);
  assert.match(helper, /\.brownie\/headless-continuations\//);
  assert.match(helper, /\.brownie\/headless-journeys\//);
  assert.match(helper, /\.brownie\/headless-objective-admissions\//);
  assert.match(helper, /\.brownie\/headless-run-sessions\//);
  assert.match(helper, /missing changed-file evidence for continuation/);
  assert.match(helper, /continuation changed files are not Runtime session artifacts/);
  assert.match(helper, /payload\.get\("continuation_required"\) is True/);
  assert.match(helper, /automation\.get\("continuation_required"\) is True/);
  assert.match(helper, /payload\.get\("controller_action"\) == "resume"/);
  assert.match(helper, /invocation\.get\("command"\) == "resume"/);
  assert.match(helper, /payload\.get\("completed"\) is False/);
  assert.match(helper, /payload\.get\("blocked"\) is False/);
  assert.match(helper, /payload\.get\("terminal_failure"\) is False/);

  const integrityStart = controller.indexOf('if ! progress_integrity_validation=');
  const integrityEnd = controller.indexOf('    write_bdk_trajectory_event "$run_stamp" "verification.run"', integrityStart);
  assert(integrityStart >= 0 && integrityEnd > integrityStart, 'post-runtime integrity block must exist');
  const integrity = controller.slice(integrityStart, integrityEnd);
  const defer = integrity.indexOf('phase_loop_can_defer_selected_target_change_for_continuation');
  const repair = integrity.indexOf('write_repair_feedback');
  assert(defer >= 0 && repair > defer, 'verified continuation must be considered before repair feedback');
  assert.match(integrity, /write_status "continuation_required"/);
  assert.match(integrity, /integrity_deferred":"selected_target_not_changed/);
});

test('explicit run-once rebaselines only a stale stop marker after acquiring ownership', () => {
  const start = controller.indexOf('  run-once)');
  const end = controller.indexOf('  *)', start);
  assert(start >= 0 && end > start, 'run-once command handler must exist');
  const runOnce = controller.slice(start, end);
  const lock = runOnce.indexOf('if ! acquire_lock; then');
  const rebaseline = runOnce.indexOf('run_once_stop_file_rebaselined=true');
  const clear = runOnce.indexOf('rm -f "$STOP_FILE"', rebaseline);
  const execution = runOnce.indexOf('run_brownie_once');
  assert(lock >= 0 && rebaseline > lock && clear > rebaseline && execution > clear);
  assert.match(runOnce, /if \[ -f "\$STOP_FILE" \]; then/);
});

test('claim snapshot restore validates durable identity before writing current claim', () => {
  const start = controller.indexOf('restore_claim_snapshot_before_runtime()');
  const end = controller.indexOf('\ncompleted_todo_cleanup_pending()', start);
  assert(start >= 0 && end > start, 'claim snapshot restore helper must exist');
  const helper = controller.slice(start, end);
  assert.match(helper, /claim\.get\("claim_id"\)/);
  assert.match(helper, /claim\.get\("selected_todo"\)/);
  assert.match(helper, /destination\.write_text/);
});

test('runtime CLI attests the active claim before admission validation and covers run/resume payloads', () => {
  const exportClaim = controller.indexOf('export BROWNIE_PHASE_LOOP_CLAIM_ID=');
  const validation = controller.indexOf(
    'phase-loop-runtime-admission.mjs" validate',
    exportClaim,
  );
  const binder = controller.indexOf('  bind_runtime_stdout_to_active_claim "$stdout_log"', validation);
  assert(validation >= 0 && binder > validation, 'admission validation must precede post-processing binder');
  assert(exportClaim >= 0 && exportClaim < validation, 'claim ID must be exported before runtime execution');

  const cli = fs.readFileSync(
    path.join(repoRoot, 'crates/brownie-cli/src/runtime_client.rs'),
    'utf8',
  );
  assert.match(cli, /PHASE_LOOP_CLAIM_ID_ENV/);
  assert.match(cli, /PHASE_LOOP_ADMISSION_FILE_ENV/);
  assert.match(cli, /attest_phase_loop_claim_id\(\s*cli_run_or_advance_payload/);
  assert.match(cli, /attest_phase_loop_claim_id\(\s*cli_resume_payload/);
  assert.match(cli, /attest_phase_loop_claim_id_payload/);
});

test('terminal todo-decomposition leaves use integrated recovery instead of nested file splitting', () => {
  const retryCap = controller.indexOf('terminal_failure_retry_cap_zero_redelegation_required');
  const recovery = controller.indexOf('recover_terminal_todo_decomposition_leaf', retryCap);
  const supervisor = controller.indexOf('terminal_todo_decomposition_no_eligible', recovery);
  const recovered = controller.indexOf('phase_loop_terminal_stalled_replan_recovered', supervisor);

  assert(retryCap >= 0 && recovery > retryCap && supervisor > recovery && recovered > supervisor);
  assert.match(controller, /selected_route != "todo-decomposition"/u);
  assert.match(controller, /terminal_task_failed/u);
  assert.match(controller, /"split \.brownie\/todo\.md and \.brownie\/todo-breakdown\.md into nested file-specific leaves"/u);
  assert.match(controller, /retire the generated todo-decomposition leaf through integrated supervisor recovery/u);
  assert.match(controller, /terminal_generated_contract_replan_requires_implementation_handoff/u);
  assert.match(controller, /feedback\.get\("delegation", \{\}\)\.get\("required_actor"\) == sys\.argv\[3\]/u);
  assert.match(controller, /feedback\.get\("delegation", \{\}\)\.get\("status"\) == "pending"/u);
});

test('missing execution evidence preserves a verified terminal-replan recovery', () => {
  const start = controller.indexOf('terminal_execution_evidence_missing_integrated_supervisor_control=true');
  const end = controller.indexOf('        if active_todo_claim_exists; then', start);
  assert(start >= 0 && end > start, 'missing-execution-evidence recovery block must exist');
  const block = controller.slice(start, end);
  assert.match(block, /phase_loop_terminal_stalled_replan_recovered/);
  assert.match(block, /terminal_execution_evidence_stalled_replan_recovery_continued=true/);
  assert.match(block, /write_status "replanned"/);
  assert.match(block, /return 0/);
});
