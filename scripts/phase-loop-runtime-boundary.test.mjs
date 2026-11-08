import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const controller = fs.readFileSync(path.join(repoRoot, 'phase-loop.sh'), 'utf8');
const claimRebaseline = fs.readFileSync(path.join(repoRoot, 'scripts/phase-loop-claim-rebaseline.mjs'), 'utf8');

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

test('PR handoff reuses only an open implementation-authored current-HEAD PR', () => {
  const helperStart = controller.indexOf('phase_loop_admit_open_implementation_pr()');
  const helperEnd = controller.indexOf('\n}\n\n# A zero process exit', helperStart);
  assert(helperStart >= 0 && helperEnd > helperStart, 'strict PR admission helper must exist');
  const helper = controller.slice(helperStart, helperEnd);
  assert.match(helper, /gh pr list[\s\S]*--state open/);
  assert.match(helper, /pullRequest\.state !== 'OPEN'/);
  assert.match(helper, /pullRequest\.headRefOid !== expectedHead/);
  assert.match(helper, /pullRequest\.author\?\.login !== implementation/);

  const publicationStart = controller.indexOf('phase_loop_create_pr_for_progress()');
  const publicationEnd = controller.indexOf('\n}\n\nphase_loop_pr_created()', publicationStart);
  assert(publicationStart >= 0 && publicationEnd > publicationStart, 'PR publication path must exist');
  const publication = controller.slice(publicationStart, publicationEnd);
  assert.match(publication, /phase_loop_admit_open_implementation_pr "\$branch"/);
  assert.doesNotMatch(publication, /gh pr view "\$branch"/);
  assert.match(publication, /phase_loop_record_delivery_pr_handoff "\$pr_url" "\$delivery_handoff" "\$run_stamp" "\$pr_admission"/);
});

test('closed handoffs can be republished from exact verified claim evidence without re-running Runtime', () => {
  const repairStart = controller.indexOf('phase_loop_refresh_pr_handoff()');
  const repairEnd = controller.indexOf('\n}\n\n# A verified implementation result', repairStart);
  assert(repairStart >= 0 && repairEnd > repairStart, 'PR handoff refresh path must exist');
  const repair = controller.slice(repairStart, repairEnd);
  assert.match(repair, /closed_or_merged_pr_cannot_be_reused_for_new_delivery_handoff/);
  assert.match(repair, /open_pr_head_advanced_before_review/);
  assert.match(repair, /superseded_delivery_reviews/);
  assert.match(repair, /write_todo_claim[\s\S]*"verification_pending"/);
  assert.match(repair, /phase_loop_create_pr_for_progress[\s\S]*"1" "\$verification"/);
  assert.doesNotMatch(repair, /run_brownie_once/);
  const commandStart = controller.indexOf('  republish-stale-pr-handoff)');
  const commandEnd = controller.indexOf('  run-once)', commandStart);
  assert(commandStart >= 0 && commandEnd > commandStart, 'stale handoff command must exist');
  const command = controller.slice(commandStart, commandEnd);
  assert.match(command, /acquire_lock/);
  assert.match(command, /phase_loop_release_supervisor_lock/);

  const refreshCommandStart = controller.indexOf('  refresh-pr-handoff)');
  const refreshCommandEnd = controller.indexOf('  run-once)', refreshCommandStart);
  assert(refreshCommandStart >= 0 && refreshCommandEnd > refreshCommandStart, 'open PR refresh command must exist');
  const refreshCommand = controller.slice(refreshCommandStart, refreshCommandEnd);
  assert.match(refreshCommand, /phase_loop_refresh_pr_handoff/);
  assert.match(refreshCommand, /acquire_lock/);
  assert.match(refreshCommand, /phase_loop_release_supervisor_lock/);
});

test('claim field lookup resolves nested review receipts rather than treating dotted paths as flat keys', () => {
  const start = controller.indexOf('claim_field()');
  const end = controller.indexOf('\n}\n\ntracked_workspace_diff_exists()', start);
  assert(start >= 0 && end > start, 'claim field helper must exist');
  const helper = controller.slice(start, end);
  assert.match(helper, /for segment in sys\.argv\[2\]\.split\("\."\)/);
  assert.match(helper, /value = value\.get\(segment, ""\)/);
});

test('handoff refresh locates the immutable Runtime execution instead of a review observation', () => {
  const receiptStart = controller.indexOf('phase_loop_record_delivery_pr_handoff()');
  const receiptEnd = controller.indexOf('\n}\n\n# Review observations', receiptStart);
  assert(receiptStart >= 0 && receiptEnd > receiptStart, 'delivery receipt and execution-run resolver must exist');
  const receipt = controller.slice(receiptStart, receiptEnd);
  assert.match(receipt, /"execution_run_stamp": sys\.argv\[4\]/);
  const resolverStart = controller.indexOf('phase_loop_verified_runtime_run_stamp()');
  const resolverEnd = controller.indexOf('\n}\n\n# Refresh a claim-bound PR handoff', resolverStart);
  assert(resolverStart >= 0 && resolverEnd > resolverStart, 'immutable execution-run resolver must exist');
  const resolver = controller.slice(resolverStart, resolverEnd);
  assert.match(resolver, /review\.get\("execution_run_stamp"\)/);
  assert.match(resolver, /entry\.get\("note"\) != "pr_handoff_recorded"/);
  const refreshStart = controller.indexOf('phase_loop_refresh_pr_handoff()');
  const refreshEnd = controller.indexOf('\n}\n\n# Compatibility alias', refreshStart);
  assert(refreshStart >= 0 && refreshEnd > refreshStart, 'handoff refresh must exist');
  assert.match(controller.slice(refreshStart, refreshEnd), /phase_loop_verified_runtime_run_stamp/);
});

test('merged review reconciliation re-verifies the merged delivery before consuming the TODO', () => {
  const reconcileStart = controller.indexOf('phase_loop_reconcile_pending_review()');
  const reconcileEnd = controller.indexOf('\n}\n\n# A Runtime task-executed envelope', reconcileStart);
  assert(reconcileStart >= 0 && reconcileEnd > reconcileStart, 'review reconciliation helper must exist');
  const reconcile = controller.slice(reconcileStart, reconcileEnd);
  const completedStart = reconcile.indexOf('    completed)');
  const completedEnd = reconcile.indexOf('    *)', completedStart);
  assert(completedStart >= 0 && completedEnd > completedStart, 'merged review completion branch must exist');
  const completed = reconcile.slice(completedStart, completedEnd);
  assert.match(completed, /phase_loop_consume_completed_review_delivery/);
  assert.doesNotMatch(completed, /record_completion_ledger_transition/);
  assert.doesNotMatch(completed, /remove_completed_todo_claim_from_queue/);

  const consumerStart = controller.indexOf('phase_loop_consume_completed_review_delivery()');
  const consumerEnd = controller.indexOf('\n}\n\nwrite_todo_claim()', consumerStart);
  assert(consumerStart >= 0 && consumerEnd > consumerStart, 'completed review delivery consumer must exist');
  const consumer = controller.slice(consumerStart, consumerEnd);
  assert.match(consumer, /phase_loop_verified_runtime_run_stamp/);
  assert.match(consumer, /phase_loop_reverify_and_consume_merged_delivery/);
  assert.match(consumer, /mark_completed_todo_cleanup_pending/);
  assert.match(consumer, /else\s+reverify_status=\$\?/);
  assert.match(consumer, /return "\$reverify_status"/);
  assert.match(
    consumer,
    /phase_loop_reverify_and_consume_merged_delivery "\$run_stamp" "\$runtime_stdout_log" "\$run_id"/,
  );
});

test('completed cleanup re-verifies an unproven reviewed merge before queue consumption', () => {
  const cleanupStart = controller.indexOf('  if completed_todo_cleanup_pending; then');
  const cleanupEnd = controller.indexOf('\n  if ', cleanupStart + 4);
  assert(cleanupStart >= 0 && cleanupEnd > cleanupStart, 'completed cleanup branch must exist');
  const cleanup = controller.slice(cleanupStart, cleanupEnd);
  assert.match(cleanup, /phase_loop_consume_completed_review_delivery/);
  assert.doesNotMatch(cleanup, /\$\(remove_completed_todo_claim_from_queue/);
});

test('a falsely cleared merged-delivery cleanup state is restored to re-verification before Runtime dispatch', () => {
  const recoveryStart = controller.indexOf('recover_unverified_completed_cleanup_state()');
  const recoveryEnd = controller.indexOf('\n}\n\nmark_completed_todo_pr_pending()', recoveryStart);
  assert(recoveryStart >= 0 && recoveryEnd > recoveryStart, 'cleanup recovery helper must exist');
  const recovery = controller.slice(recoveryStart, recoveryEnd);
  assert.match(recovery, /queue_removal_cleanup_completed/);
  assert.match(recovery, /claim\["completion_cleanup_pending"\] = True/);
  assert.match(recovery, /queue_removal_cleanup_recovered_after_unverified_completion/);
  assert.match(recovery, /\[ -f "\$TODO_CLAIM_FILE" \] \|\| return 0/,
    'an absent claim must be a recovery no-op');
  assert.match(recovery, /else\s+recovery_status=\$\?/);
  assert.match(recovery, /if \[ "\$recovery_status" -ne 0 \]; then[\s\S]*return "\$recovery_status"/);
  assert.match(recovery, /return "\$recovery_status"[\s\S]*sync_parent_dir/);

  const runStart = controller.indexOf('  if terminal_failure_source_transition_pending; then');
  const cleanupStart = controller.indexOf('  if completed_todo_cleanup_pending; then', runStart);
  const recoveryCall = controller.indexOf('recover_unverified_completed_cleanup_state "$run_stamp"', runStart);
  assert(recoveryCall > runStart && recoveryCall < cleanupStart,
    'cleanup recovery must run before cleanup handling and any later Runtime dispatch');
});

test('merged delivery verification refreshes and verifies the configured observed base revision', () => {
  const reverifyStart = controller.indexOf('phase_loop_reverify_and_consume_merged_delivery()');
  const reverifyEnd = controller.indexOf('\n}\n\n# A completed claim may be retried', reverifyStart);
  assert(reverifyStart >= 0 && reverifyEnd > reverifyStart, 'merged delivery re-verifier must exist');
  const reverify = controller.slice(reverifyStart, reverifyEnd);
  assert.match(reverify, /git -C "\$PHASE_LOOP_WORKSPACE_ROOT" fetch --quiet "\$PHASE_LOOP_PR_REMOTE" "\$PHASE_LOOP_PR_BASE"/);
  assert.match(reverify, /--revision "\$merged_delivery_revision"/);
  assert.match(reverify, /PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY/);
  assert.match(reverify, /Merged delivery re-verification could not refresh the configured PR base/);
  assert.match(reverify, /statusCheckRollup,files/,
    'both source-delivery and claim-bound handoff PRs must retain their changed-file evidence');
  assert.match(reverify, /merged-delivery-task-attestation/,
    'a split delivery must collect the separately task-bound handoff review');
  assert.match(reverify, /delivery_review/,
    'the handoff identity must be read from the immutable active claim rather than inferred from a branch');
  assert.match(reverify, /if \[ -n "\$task_review_identity" \]; then/,
    'ordinary task-bound source PRs must not require a redundant handoff receipt');
  assert.match(reverify, /"pr_number": value\.get\("number"\)/,
    'GitHub PR JSON must normalize number before the immutable handoff identity is checked');
});

test('claimed-task-not-admitted recovery persists zero-execution evidence and a terminal progress projection after rollback', () => {
  const block = mismatchRecoveryBlock();
  const restoreClaim = block.indexOf('restore_claim_snapshot_before_runtime "$claim_snapshot_before_runtime"');
  const evidence = block.indexOf('write_runtime_execution_evidence "$run_stamp" "$stdout_log" "$claim_snapshot_before_runtime"');
  const progress = block.indexOf('write_progress_state "$stdout_log" "$run_stamp" "$exit_code"');
  assert(restoreClaim >= 0 && evidence > restoreClaim && progress > evidence,
    'the claim must be restored before durable no-execution evidence and progress are written');
  assert.match(block, /workspace_after="\$\(git_workspace_fingerprint\)"/);
  assert.match(block, /mismatch_execution_evidence_status/);
  assert.match(block, /mismatch_progress_status/);
  const writerStart = controller.indexOf('write_runtime_execution_evidence()');
  const writerEnd = controller.indexOf('\n}\n\nis_running()', writerStart);
  assert(writerStart >= 0 && writerEnd > writerStart, 'terminal evidence writer must exist');
  const writer = controller.slice(writerStart, writerEnd);
  assert.match(writer, /value\.get\("kind"\) == "phase_loop_terminal_failure_execution_evidence"/);
  assert.match(writer, /return "\$\{status:-1\}"/,
    'admission recovery must fail closed if its durable zero-execution receipt cannot be written');
});

test('post-runtime target validators capture failures instead of escaping run-once', () => {
  const validators = [
    'node "$ROOT_DIR/scripts/guard-json-parse.mjs" "$active_target_path"',
    'node --check "$active_target_path"',
    'node "$ROOT_DIR/scripts/guard-js-duplicate-exports.mjs" "$PHASE_LOOP_WORKSPACE_ROOT/$active_target_path"'
  ];
  for (const validator of validators) {
    const marker = controller.lastIndexOf(validator);
    assert(marker >= 0, `${validator} validator must exist`);
    const window = controller.slice(Math.max(0, marker - 320), marker + 560);
    assert.match(
      window,
      /if active_target_[a-z_]+_output="\$\([\s\S]*?\)"; then[\s\S]*?active_target_[a-z_]+_status=0[\s\S]*?else[\s\S]*?active_target_[a-z_]+_status=\$\?/,
      `${validator} failure must enter its bounded recovery branch rather than trigger errexit`,
    );
  }
});

test('a syntax-invalid objective apply restores the target and continues the same claim with repair feedback', () => {
  const start = controller.indexOf('if [ "$active_target_syntax_status" -ne 0 ]; then');
  const end = controller.indexOf('    if [ -f "$ROOT_DIR/scripts/guard-js-duplicate-exports.mjs" ]; then', start);
  assert(start >= 0 && end > start, 'syntax recovery block must exist');
  const recovery = controller.slice(start, end);
  assert.match(recovery, /restore_active_target_baseline/);
  assert.match(recovery, /write_repair_feedback/);
  assert.match(recovery, /write_todo_claim "\$\(claim_field claim_id\)" "in_progress"/);
  assert.match(recovery, /write_status "continuation_required"/);
  assert.match(recovery, /"todo\.repair_feedback" '\{"reason":"syntax_breaking_target_restored"\}'/);
  assert.doesNotMatch(recovery, /archive_stale_todo_claim/);
  assert.doesNotMatch(recovery, /"todo\.blocked" '\{"reason":"syntax_breaking_target_restored"\}'/);
});

test('duplicate-declaration recovery binds feedback to the restored selected target', () => {
  const promptGeneratorStart = controller.indexOf('if ! python3 - "$output_path" "$meta_path"');
  const promptGeneratorEnd = controller.indexOf('def sha256_text(text):', promptGeneratorStart);
  assert(promptGeneratorStart >= 0 && promptGeneratorEnd > promptGeneratorStart,
    'prompt generator must include its syntax-validation helper');
  const promptGenerator = controller.slice(promptGeneratorStart, promptGeneratorEnd);
  assert.match(promptGenerator, /import subprocess/);
  assert.match(promptGenerator, /def javascript_syntax_valid\(path\):/);
  assert.match(promptGenerator, /\["node", "--check", str\(path\)\]/);
  assert.match(
    controller,
    /live_guard\.returncode != 0 and "TODO decomposition guard failed:" in \(live_guard\.stdout \+ live_guard\.stderr\)/,
    'a package-manager bootstrap failure must not be misclassified as a malformed TODO queue',
  );
  assert.match(
    controller,
    /todo_guard_semantic_failure = any\([\s\S]*?"TODO decomposition guard failed:"/,
    'persisted repair feedback must also retain the guard semantic-failure evidence',
  );
  const postApplyGuardStart = controller.indexOf('validate_todo_decomposition_after_runtime_apply()');
  const postApplyGuardEnd = controller.indexOf('\n}\n\nvalidate_phase_loop_progress_integrity_after_runtime_apply()', postApplyGuardStart);
  assert(postApplyGuardStart >= 0 && postApplyGuardEnd > postApplyGuardStart,
    'post-runtime TODO guard validator must exist');
  const postApplyGuard = controller.slice(postApplyGuardStart, postApplyGuardEnd);
  assert.match(postApplyGuard, /grep -Fq 'TODO decomposition guard failed:'/,
    'post-runtime package-manager failures must not overwrite bounded-leaf repair feedback');
  assert.match(controller, /duplicate_const_syntax_error_target: `\{selected_leaf_target_path\}`/);
  assert.match(controller, /restored_duplicate_declaration_policy: the supervisor restored `\{selected_leaf_target_path\}`/);
  assert.match(controller, /if duplicate_count <= 1 and javascript_syntax_valid\(target_path\):/);
  assert.match(controller, /Do not issue workspace\.write and do not recreate the duplicate/);
  assert.match(controller, /Run every selected TODO verification command against the restored target/);
  assert.match(controller, /do not assume it is a simple const declaration/);
  assert.doesNotMatch(
    controller,
    /duplicate_const_syntax_error_policy:[^\n]*Repair `scripts\/release-runtime-operational-evidence\.mjs` directly/
  );
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
  assert.match(sourceRecovery, /resolve-claim-attempt[^\n]+--claim "\$ledger_claim_path"/);
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

test('review-rework recovery invalidates a stale Runtime continuation until an admitted fresh run clears its marker', () => {
  const lineageReconciliationStart = controller.indexOf('phase_loop_reconcile_persisted_review_rework()');
  const lineageReconciliationCall = controller.indexOf('phase_loop_reconcile_persisted_review_rework "$run_stamp"');
  const staleClaimRestoreCall = controller.indexOf('phase_loop_restore_admission_backed_stale_claim "$run_stamp"');
  const staleClaimRebaselineCall = controller.indexOf('phase_loop_rebaseline_stale_claim "$run_stamp"');
  assert(lineageReconciliationStart >= 0, 'review-rework lineage reconciliation helper must exist');
  assert(lineageReconciliationCall >= 0 && lineageReconciliationCall < staleClaimRestoreCall);
  assert(staleClaimRestoreCall >= 0 && staleClaimRestoreCall < staleClaimRebaselineCall);
  const lineageReconciliation = controller.slice(lineageReconciliationStart, controller.indexOf('\nphase_loop_restore_admission_backed_stale_claim()', lineageReconciliationStart));
  assert.match(lineageReconciliation, /reconcile-review-rework/);
  assert.match(lineageReconciliation, /--actor-deployment "\$PHASE_LOOP_ACTOR_DEPLOYMENT"/);
  assert.match(lineageReconciliation, /review_rework_lineage_reconciliation_exit/);

  const resumeStart = controller.indexOf('phase_loop_should_resume_active_claim()');
  const resumeEnd = controller.indexOf('\nwrite_progress_state()', resumeStart);
  assert(resumeStart >= 0 && resumeEnd > resumeStart, 'resume selection helper must exist');
  const resume = controller.slice(resumeStart, resumeEnd);
  assert.match(resume, /claim\.get\("review_rework_fresh_dispatch_pending"\) is True/);
  assert.match(resume, /return 1/);

  const clearStart = controller.indexOf('clear_fresh_runtime_dispatch_pending()');
  const clearEnd = controller.indexOf('\nbind_runtime_stdout_to_active_claim()', clearStart);
  assert(clearStart >= 0 && clearEnd > clearStart, 'fresh-dispatch clear helper must exist');
  const clear = controller.slice(clearStart, clearEnd);
  assert.match(clear, /claim\["review_rework_fresh_dispatch_pending"\] = False/);
  assert.match(clear, /claim\["review_rework_fresh_dispatch_activated_run_stamp"\] = run_stamp/);
  assert.match(clear, /claim\["review_rework_fresh_dispatch_activated_at"\] = timestamp/);

  const admissionStart = controller.indexOf('  # A fresh Runtime admission can legitimately retire');
  const admissionEnd = controller.indexOf('\n  bind_runtime_stdout_to_active_claim', admissionStart);
  assert(admissionStart >= 0 && admissionEnd > admissionStart, 'fresh admission marker boundary must exist');
  const admission = controller.slice(admissionStart, admissionEnd);
  assert.match(admission, /if \[ "\$use_resume" -ne 1 \].*clear_fresh_runtime_dispatch_pending "\$run_stamp"/s);
  assert.match(admission, /fresh_runtime_dispatch_marker_clear_failed/);

  assert.match(controller, /phase_loop_rebaseline_stale_claim "\$run_stamp"/);
  assert.match(
    claimRebaseline,
    /review_rework_fresh_dispatch_claim_preserved_for_same_root_admission/,
    'the review-rework root must survive the stale-claim boundary before fresh Runtime admission',
  );
  assert.match(
    controller,
    /queue_state_generation == int\(claim\.get\("queue_generation"\) or 1\)/,
    'a preserved review-rework claim must synchronize generation-only queue drift before later resume',
  );
});

test('review-rework repair feedback never terminalizes a replayed isolated attempt', () => {
  const repairFeedback = 'write_bdk_trajectory_event "$run_stamp" "todo.repair_feedback" \'{"reason":"verified_noop_dirty_baseline_repair_feedback_recorded"}\'';
  assert.match(controller, new RegExp(repairFeedback.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(
    controller,
    /write_bdk_trajectory_event "\$run_stamp" "todo\.repair_feedback" '\{"reason":"verified_noop_dirty_baseline_repair_feedback_recorded"\}' "todo\.replanned"/,
    'repair feedback is observational; only an explicit replacement transaction may terminalize a task attempt',
  );
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

test('verified objective-apply continuations preserve the claim for resume instead of entering completion handoff', () => {
  const helperStart = controller.indexOf('phase_loop_is_verified_objective_apply_resume_continuation()');
  const helperEnd = controller.indexOf('\n# Versions before the objective-apply continuation boundary', helperStart);
  assert(helperStart >= 0 && helperEnd > helperStart, 'claim-bound objective-apply continuation helper must exist');
  const helper = controller.slice(helperStart, helperEnd);
  assert.match(helper, /payload\.get\("task_execution_confirmed"\) is True/);
  assert.match(helper, /payload\.get\("objective_apply_applied"\) is True/);
  assert.match(helper, /payload\.get\("phase_loop_claim_id"\) == claim\.get\("claim_id"\)/);
  assert.match(helper, /payload\.get\("phase_loop_selected_todo_sha256"\) == selected_sha256/);
  assert.match(helper, /payload\.get\("phase_loop_queue_fingerprint"\) == claim\.get\("queue_fingerprint"\)/);
  assert.match(helper, /payload\.get\("phase_loop_queue_generation"\) == claim\.get\("queue_generation"\)/);
  assert.match(helper, /automation\.get\("continuation_required"\) is True/);
  assert.match(helper, /terminal_final_state = str\(payload\.get\("terminal_completion_final_state"\) or ""\)/);
  assert.match(helper, /terminal_task_status = str\(payload\.get\("terminal_completion_task_status"\) or ""\)/);
  assert.match(helper, /and terminal_final_state == ""/);
  assert.match(helper, /and terminal_task_status == ""/);
  assert.match(helper, /invocation\.get\("command"\) == "resume"/);

  const completionStart = controller.indexOf('local verification_completion');
  const completionEnd = controller.indexOf('# Record the terminal ledger event', completionStart);
  assert(completionStart >= 0 && completionEnd > completionStart, 'verified objective-apply completion block must exist');
  const completion = controller.slice(completionStart, completionEnd);
  const continuation = completion.indexOf('phase_loop_is_verified_objective_apply_resume_continuation "$stdout_log"');
  const handoff = completion.indexOf('phase_loop_handoff_verified_completion');
  assert(continuation >= 0 && handoff > continuation, 'verified continuation must be routed before completion handoff');
  assert.match(completion, /write_todo_claim "\$\(claim_field claim_id\)" "in_progress"/);
  assert.match(completion, /write_status "continuation_required"/);
  assert.match(completion, /completion_handoff":"deferred_for_verified_objective_apply/);
});

test('controller recovers only the legacy false integrity block with the same claim-bound resume receipt', () => {
  const recoveryStart = controller.indexOf('phase_loop_restore_verified_objective_apply_continuation_claim()');
  const recoveryEnd = controller.indexOf('\n# A Runtime continuation can durably update', recoveryStart);
  assert(recoveryStart >= 0 && recoveryEnd > recoveryStart, 'legacy continuation recovery helper must exist');
  const recovery = controller.slice(recoveryStart, recoveryEnd);
  assert.match(recovery, /claim\.get\("status"\) != "integrity_blocked"/);
  assert.match(recovery, /status\.get\("status"\) != "integrity_blocked"/);
  assert.match(recovery, /startswith\("Completion handoff refused:"\)/);
  assert.match(recovery, /phase_loop_is_verified_objective_apply_resume_continuation "\$recovery_stdout"/);
  assert.match(recovery, /verified_objective_apply_continuation_recovered=true/);
  assert.match(recovery, /write_status "continuation_required"/);
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
