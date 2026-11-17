// Retained actual Runtime wire values from the bounded objective acceptance probe.
// These fixtures test compatibility; they do not recreate the original execution.
export const objectiveContinuationFixtures: Array<{
  [key: string]: unknown;
  request: { [key: string]: unknown; id: number; method: string; params: Record<string, unknown> };
  response: { [key: string]: unknown; result: Record<string, unknown> };
}> = [
  {
    "started_at": "2026-11-17T15:33:48.394578+00:00",
    "observed_at": "2026-11-17T15:33:48.841953+00:00",
    "request": {
      "jsonrpc": "2.0",
      "id": 5,
      "method": "headless.run.drive",
      "params": {
        "authorize": true,
        "session_id": "certify.positive",
        "drive_id": "certify.positive.drive",
        "expected_start_session_sequence": 0,
        "max_advances": 1,
        "max_steps_per_advance": 1,
        "context_budget": {
          "max_prompt_chars": 32768,
          "max_ledger_events": 16,
          "max_selected_index_chars": 1024
        },
        "journey_admission": {
          "journey_id": "certify.positive.journey",
          "authorize_journey_start": true,
          "task_start": {
            "goal": "Implement README update, replacing its content with new README content. Verify the objective with the required workspace cargo test before accepting completion.",
            "mode_id": "implementer"
          },
          "objective_context": {
            "authorize_objective_context_admission": true,
            "objective_id": "certify.positive.objective",
            "objective_fingerprint": "sha256:8888888888888888888888888888888888888888888888888888888888888888",
            "selected_index_context": {
              "bytes_read": 29,
              "content": "pub fn selected_context() {}\n",
              "content_hash_verified": true,
              "content_sha256": "sha256:a7bb38e54f110880b5cf79713898c156e6401beccdf987d2c336657c71a35440",
              "file_kind": "Rust",
              "ledger_event_id": "event_d25fefe8-b85e-44b9-a062-68c84b681c97",
              "ledger_event_kind": "CodebaseIndexSelectionReadCompleted",
              "next_action": "use_selected_file_context_for_prompt_materialization",
              "path": "src/runtime/query.rs",
              "query_fingerprint": "sha256:cdbe0817d5105e21c8d664d6898c22bfa244516b3eb32c9dbcc89da08ca6dfd6",
              "query_id": "query_cdbe0817d5105e21",
              "selection_fingerprint": "sha256:8bb3ece007922608dc17d1c462f6e51d0cbf9c77474d53f5fc637c5fc0da1a53",
              "selection_id": "selection_8bb3ece007922608",
              "snapshot": {
                "built_at": "2026-11-17T15:33:47.795274Z",
                "index_id": "idx_c1ec04775e75b1f1",
                "root": ".",
                "snapshot_fingerprint": "sha256:c1ec04775e75b1f11e68d5f106ebacd82b489695585c248c02b284937041c497",
                "truncated": false,
                "workspace_fingerprint": "sha256:d3366cc379b77a4f1ebb6ff5bf14620fdf1e82131a0ba0248c393f7b860bcd89"
              },
              "truncated": false
            }
          }
        }
      }
    },
    "response": {
      "jsonrpc": "2.0",
      "id": 5,
      "result": {
        "advance_count": 1,
        "advances": [
          {
            "advance_id": "certify.positive.drive.1",
            "checkpoint_fingerprint": "sha256:3571a731d4aaef563a0b61fee7bac2337703061a78fca827582464649e39f9f1",
            "executed_count": 1,
            "max_steps": 1,
            "next_action": "inspect_progress_overview",
            "next_route": {
              "aggregate_sequence": 20261117153348750,
              "kind": "no_eligible_task",
              "next_action": "inspect_progress_overview",
              "progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
              "reason": "Selected task is terminal and no eligible continuation task remains."
            },
            "post_progress": {
              "aggregate_sequence": 20261117153348750,
              "progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736"
            },
            "replayed": false,
            "replayed_count": 0,
            "session_id": "certify.positive",
            "session_sequence": 1,
            "start_progress": {
              "aggregate_sequence": 20261117153348396,
              "progress_fingerprint": "sha256:6621613323362c63c1d5484b5f1cb24fe0aa955ae77ae48230393f472ba295c2"
            },
            "status": "task_executed",
            "step_count": 1,
            "steps": [
              {
                "candidate_count": 1,
                "context_budget": {
                  "included_events": 16,
                  "max_ledger_events": 16,
                  "max_prompt_chars": 32768,
                  "max_selected_index_chars": 1024,
                  "omitted_events": 3,
                  "prompt_chars": 7957,
                  "prompt_within_budget": true,
                  "protected_context_chars": 7957,
                  "requested": true,
                  "selected_index_content_chars": 29,
                  "selected_index_context_present": true,
                  "selected_index_materialized_chars": 29,
                  "selected_index_truncated": false,
                  "total_events": 19
                },
                "continuation_id": "run.certify.positive.1",
                "current_aggregate_sequence": 20261117153348396,
                "current_progress_fingerprint": "sha256:6621613323362c63c1d5484b5f1cb24fe0aa955ae77ae48230393f472ba295c2",
                "decision_id": "headless_decision_b5dfa10f74214763b19beebfa26e9a95",
                "next_action": "inspect_progress_overview",
                "next_route": {
                  "aggregate_sequence": 20261117153348750,
                  "kind": "no_eligible_task",
                  "next_action": "inspect_progress_overview",
                  "progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
                  "reason": "Selected task is terminal and no eligible continuation task remains."
                },
                "post_aggregate_sequence": 20261117153348750,
                "post_progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
                "replayed": false,
                "selected_run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
                "selected_task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130",
                "status": "task_executed",
                "step_index": 1,
                "terminal_completion_evidence": {
                  "completion_result_fingerprint": "sha256:41dd6c6d49c4079067965e9c6814f000352559ae4a323836f06ba20136c67a5c",
                  "completion_summary_chars": 82,
                  "completion_summary_preview": "Second-pass LLM agent loop completed for task_15b7a67f-2da1-4987-973e-7e8ccc4de130",
                  "completion_summary_truncated": false,
                  "final_response_chars": 229,
                  "final_response_present": true,
                  "final_state": "Completed",
                  "replayed": false,
                  "task_status": "Completed"
                }
              }
            ],
            "stop_reason": "budget_exhausted",
            "terminal_completion_evidence": {
              "completion_result_fingerprint": "sha256:41dd6c6d49c4079067965e9c6814f000352559ae4a323836f06ba20136c67a5c",
              "completion_summary_chars": 82,
              "completion_summary_preview": "Second-pass LLM agent loop completed for task_15b7a67f-2da1-4987-973e-7e8ccc4de130",
              "completion_summary_truncated": false,
              "final_response_chars": 229,
              "final_response_present": true,
              "final_state": "Completed",
              "replayed": false,
              "task_status": "Completed"
            }
          }
        ],
        "completion_closure": {
          "aggregate_sequence": 20261117153348750,
          "blocked_task_count": 0,
          "closure_fingerprint": "sha256:0858b19c1ca51f645cab6b9d2a957231e22abeec383d6a618d454358672ab1b3",
          "next_action": "review_and_authorize_objective_proposal",
          "progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
          "route_candidate_count": 0,
          "route_kind": "review_and_authorize_objective_proposal",
          "route_run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
          "route_task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130",
          "runnable_task_count": 0,
          "status": "routed_explicit_action",
          "stop_reason": "objective_proposal_candidate_ready",
          "terminal_completion_fingerprint": "sha256:41dd6c6d49c4079067965e9c6814f000352559ae4a323836f06ba20136c67a5c",
          "terminal_task_count": 1,
          "total_task_count": 1
        },
        "drive_fingerprint": "sha256:22c0131275d60bfa974a91e6b7c1fc79de4e840b81bf6bdeeab605e2f5c23f97",
        "drive_id": "certify.positive.drive",
        "end_session_sequence": 1,
        "executed_count": 1,
        "execution_outcome": {
          "blocked": false,
          "class": "continuation_required",
          "completed": false,
          "continuation_required": true,
          "controller_action": "resume",
          "next_invocation": {
            "arguments": [],
            "command": "resume"
          },
          "outcome_scope": "objective",
          "retryable": true,
          "schema_version": 1,
          "status": "continuation_required",
          "stop_reason": "objective_proposal_candidate_ready",
          "terminal_failure": false
        },
        "journey": {
          "closure_status": "routed_explicit_action",
          "drive_id": "certify.positive.drive",
          "journey_fingerprint": "sha256:885e6244bd1664dc64803034a1fc36e55ab56e9dda25424b5739b50fc9e445bd",
          "journey_id": "certify.positive.journey",
          "next_action": "review_and_authorize_objective_proposal",
          "objective_context": {
            "bytes_read": 29,
            "content_char_count": 29,
            "content_sha256": "sha256:a7bb38e54f110880b5cf79713898c156e6401beccdf987d2c336657c71a35440",
            "file_kind": "Rust",
            "index_id": "idx_c1ec04775e75b1f1",
            "next_action": "run_admitted_coding_task",
            "objective_context_fingerprint": "sha256:144f0b91e5057dbf7f648178c820983bd3f02f2c80fc57b02b6767ecd73408e1",
            "objective_fingerprint": "sha256:8888888888888888888888888888888888888888888888888888888888888888",
            "objective_id": "certify.positive.objective",
            "prompt_context_id": "ctx_eeb344fc79697a4a",
            "query_fingerprint": "sha256:cdbe0817d5105e21c8d664d6898c22bfa244516b3eb32c9dbcc89da08ca6dfd6",
            "query_id": "query_cdbe0817d5105e21",
            "read_path_fingerprint": "sha256:884c0839f0a6d44c3ef803f74b1a896da1c69808b9ffb817ec64f0c5e8330da5",
            "selected_context_fingerprint": "sha256:787dddbc52d1640212a92b8b9b926f4de8733a65df8bc8772ca47474d95f6c92",
            "selection_fingerprint": "sha256:8bb3ece007922608dc17d1c462f6e51d0cbf9c77474d53f5fc637c5fc0da1a53",
            "selection_id": "selection_8bb3ece007922608",
            "snapshot_fingerprint": "sha256:c1ec04775e75b1f11e68d5f106ebacd82b489695585c248c02b284937041c497",
            "source_event_id": "event_d25fefe8-b85e-44b9-a062-68c84b681c97",
            "source_event_kind": "CodebaseIndexSelectionReadCompleted",
            "workspace_fingerprint": "sha256:d3366cc379b77a4f1ebb6ff5bf14620fdf1e82131a0ba0248c393f7b860bcd89"
          },
          "post_aggregate_sequence": 20261117153348750,
          "post_progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
          "proposal_candidate": {
            "approval_status": "Pending",
            "candidate_count": 1,
            "candidate_fingerprint": "sha256:af34177c895df8db3e989d38e5b92c1f0f11a49f04f11e6447aef058e7f04762",
            "drive_id": "certify.positive.drive",
            "journey_id": "certify.positive.journey",
            "next_action": "review_and_authorize_objective_proposal",
            "objective_context_fingerprint": "sha256:144f0b91e5057dbf7f648178c820983bd3f02f2c80fc57b02b6767ecd73408e1",
            "operation": "patch_file",
            "path_fingerprint": "sha256:b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5",
            "proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
            "replayed": false,
            "run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
            "selected_context_fingerprint": "sha256:787dddbc52d1640212a92b8b9b926f4de8733a65df8bc8772ca47474d95f6c92",
            "session_id": "certify.positive",
            "source_event_id": "event_9993cfc6-7e38-4878-a3c9-4ddccbe3ccf7",
            "source_event_kind": "WorkspacePatchProposed",
            "status": "ready_for_review",
            "task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130",
            "validation_status": "Valid"
          },
          "replayed": false,
          "run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
          "session_id": "certify.positive",
          "start_aggregate_sequence": 20261117153348396,
          "start_progress_fingerprint": "sha256:6621613323362c63c1d5484b5f1cb24fe0aa955ae77ae48230393f472ba295c2",
          "task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130"
        },
        "max_advances": 1,
        "max_steps_per_advance": 1,
        "next_action": "review_and_authorize_objective_proposal",
        "next_route": {
          "aggregate_sequence": 20261117153348750,
          "kind": "review_and_authorize_objective_proposal",
          "next_action": "review_and_authorize_objective_proposal",
          "progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
          "proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
          "reason": "Journey produced one bounded proposal candidate; review and authorize it explicitly.",
          "run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
          "task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130"
        },
        "objective_proposal_candidate": {
          "approval_status": "Pending",
          "candidate_count": 1,
          "candidate_fingerprint": "sha256:af34177c895df8db3e989d38e5b92c1f0f11a49f04f11e6447aef058e7f04762",
          "drive_id": "certify.positive.drive",
          "journey_id": "certify.positive.journey",
          "next_action": "review_and_authorize_objective_proposal",
          "objective_context_fingerprint": "sha256:144f0b91e5057dbf7f648178c820983bd3f02f2c80fc57b02b6767ecd73408e1",
          "operation": "patch_file",
          "path_fingerprint": "sha256:b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5",
          "proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
          "replayed": false,
          "run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
          "selected_context_fingerprint": "sha256:787dddbc52d1640212a92b8b9b926f4de8733a65df8bc8772ca47474d95f6c92",
          "session_id": "certify.positive",
          "source_event_id": "event_9993cfc6-7e38-4878-a3c9-4ddccbe3ccf7",
          "source_event_kind": "WorkspacePatchProposed",
          "status": "ready_for_review",
          "task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130",
          "validation_status": "Valid"
        },
        "post_progress": {
          "aggregate_sequence": 20261117153348750,
          "progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736"
        },
        "replayed": false,
        "replayed_count": 0,
        "session_id": "certify.positive",
        "start_progress": {
          "aggregate_sequence": 20261117153348396,
          "progress_fingerprint": "sha256:6621613323362c63c1d5484b5f1cb24fe0aa955ae77ae48230393f472ba295c2"
        },
        "start_session_sequence": 0,
        "status": "task_executed",
        "stop_reason": "objective_proposal_candidate_ready",
        "terminal_completion_evidence": {
          "completion_result_fingerprint": "sha256:41dd6c6d49c4079067965e9c6814f000352559ae4a323836f06ba20136c67a5c",
          "completion_summary_chars": 82,
          "completion_summary_preview": "Second-pass LLM agent loop completed for task_15b7a67f-2da1-4987-973e-7e8ccc4de130",
          "completion_summary_truncated": false,
          "final_response_chars": 229,
          "final_response_present": true,
          "final_state": "Completed",
          "replayed": false,
          "task_status": "Completed"
        }
      }
    }
  },
  {
    "started_at": "2026-11-17T15:33:48.843210+00:00",
    "observed_at": "2026-11-17T15:33:48.902212+00:00",
    "request": {
      "jsonrpc": "2.0",
      "id": 6,
      "method": "headless.continue_once",
      "params": {
        "authorize": true,
        "continuation_id": "certify.positive.auth",
        "expected_progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
        "expected_aggregate_sequence": 20261117153348750,
        "objective_proposal_authorization_preflight_target": {
          "journey_id": "certify.positive.journey",
          "session_id": "certify.positive",
          "source_drive_id": "certify.positive.drive",
          "expected_candidate_fingerprint": "sha256:af34177c895df8db3e989d38e5b92c1f0f11a49f04f11e6447aef058e7f04762",
          "expected_objective_context_fingerprint": "sha256:144f0b91e5057dbf7f648178c820983bd3f02f2c80fc57b02b6767ecd73408e1",
          "expected_selected_context_fingerprint": "sha256:787dddbc52d1640212a92b8b9b926f4de8733a65df8bc8772ca47474d95f6c92",
          "expected_task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130",
          "expected_run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
          "expected_proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
          "expected_source_event_id": "event_9993cfc6-7e38-4878-a3c9-4ddccbe3ccf7",
          "expected_source_event_kind": "WorkspacePatchProposed",
          "expected_operation": "patch_file",
          "expected_path_fingerprint": "sha256:b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5",
          "expected_validation_status": "Valid",
          "expected_approval_status": "Pending",
          "expected_journey_fingerprint": "sha256:885e6244bd1664dc64803034a1fc36e55ab56e9dda25424b5739b50fc9e445bd",
          "authorize_objective_proposal_preflight": true,
          "authorization_token_fingerprint": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
        }
      }
    },
    "response": {
      "jsonrpc": "2.0",
      "id": 6,
      "result": {
        "candidate_count": 1,
        "continuation_id": "certify.positive.auth",
        "current_aggregate_sequence": 20261117153348750,
        "current_progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
        "decision_id": "headless_decision_2c561ffc576945e8b851d4a1ee2ae7bc",
        "expected_aggregate_sequence": 20261117153348750,
        "expected_progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
        "next_action": "apply_authorized_objective_proposal",
        "next_route": {
          "aggregate_sequence": 20261117153348750,
          "apply_fingerprint": "sha256:5399cf71dee16fc42b623ece0767a40b97851f04aa2014896765584d8b1cb8b7",
          "kind": "apply_authorized_objective_proposal_explicitly",
          "next_action": "apply_authorized_objective_proposal",
          "progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
          "proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
          "reason": "Authorized and preflighted the objective proposal candidate; controlled apply remains an explicit next step.",
          "run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
          "task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130"
        },
        "objective_proposal_authorization_preflight_result": {
          "apply_plan": {
            "checklist": [
              {
                "name": "proposal_exists",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "proposal_is_valid",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "proposal_is_approved",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "target_path_safe",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "target_file_exists",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "target_file_regular",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "target_file_utf8",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "target_file_hash_captured",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "proposal_not_stale",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "diff_preview_available",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "sensitive_content_not_detected",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "apply_execution_available",
                "reason": "Patch apply is available through proposal.apply.",
                "status": "Pass"
              }
            ],
            "plan_id": "plan_29bbbf582d404c6486b713d897363e7f",
            "proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
            "status": "Ready"
          },
          "approval_status": "Approved",
          "approved_at": "2026-11-17T15:33:48.858068Z",
          "authorization_preflight_fingerprint": "sha256:5399cf71dee16fc42b623ece0767a40b97851f04aa2014896765584d8b1cb8b7",
          "authorization_token_fingerprint": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          "candidate_fingerprint": "sha256:af34177c895df8db3e989d38e5b92c1f0f11a49f04f11e6447aef058e7f04762",
          "journey_id": "certify.positive.journey",
          "next_action": "apply_authorized_objective_proposal",
          "objective_context_fingerprint": "sha256:144f0b91e5057dbf7f648178c820983bd3f02f2c80fc57b02b6767ecd73408e1",
          "operation": "patch_file",
          "path_fingerprint": "sha256:b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5",
          "preflight_snapshot": {
            "canonical_path_hash": "sha256:1dde41ac088bbd3aa28bb0130488f66fc163ea998391a78ecd3a30411b146e55",
            "captured_at": "2026-11-17T15:33:48.873978Z",
            "file_exists": true,
            "file_kind": "File",
            "file_modified_unix_ms": 1794929627762,
            "file_sha256": "sha256:39cd28753247d164f4c7b85b3e1b9d32c29068b04cd860912674d04da21c7189",
            "file_size_bytes": 15,
            "path": "README.md",
            "proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
            "snapshot_id": "snapshot_6a7e02f00f4347e889dc02e31e00d0d8",
            "stale": false,
            "stale_reason": null
          },
          "proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
          "replayed": false,
          "run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
          "selected_context_fingerprint": "sha256:787dddbc52d1640212a92b8b9b926f4de8733a65df8bc8772ca47474d95f6c92",
          "session_id": "certify.positive",
          "source_drive_id": "certify.positive.drive",
          "source_event_id": "event_9993cfc6-7e38-4878-a3c9-4ddccbe3ccf7",
          "source_event_kind": "WorkspacePatchProposed",
          "status": "authorized_preflight_ready",
          "task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130",
          "validation_status": "Valid"
        },
        "post_aggregate_sequence": 20261117153348750,
        "post_progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
        "replayed": false,
        "selected_run_id": null,
        "selected_task_id": null,
        "stale": false,
        "status": "task_executed",
        "task_run_result": null
      }
    }
  },
  {
    "started_at": "2026-11-17T15:33:48.903105+00:00",
    "observed_at": "2026-11-17T15:33:48.976363+00:00",
    "request": {
      "jsonrpc": "2.0",
      "id": 7,
      "method": "headless.continue_once",
      "params": {
        "authorize": true,
        "continuation_id": "certify.positive.apply",
        "expected_progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
        "expected_aggregate_sequence": 20261117153348750,
        "objective_proposal_apply_target": {
          "journey_id": "certify.positive.journey",
          "session_id": "certify.positive",
          "source_drive_id": "certify.positive.drive",
          "expected_candidate_fingerprint": "sha256:af34177c895df8db3e989d38e5b92c1f0f11a49f04f11e6447aef058e7f04762",
          "expected_objective_context_fingerprint": "sha256:144f0b91e5057dbf7f648178c820983bd3f02f2c80fc57b02b6767ecd73408e1",
          "expected_selected_context_fingerprint": "sha256:787dddbc52d1640212a92b8b9b926f4de8733a65df8bc8772ca47474d95f6c92",
          "expected_task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130",
          "expected_run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
          "expected_proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
          "expected_source_event_id": "event_9993cfc6-7e38-4878-a3c9-4ddccbe3ccf7",
          "expected_source_event_kind": "WorkspacePatchProposed",
          "expected_operation": "patch_file",
          "expected_path_fingerprint": "sha256:b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5",
          "expected_validation_status": "Valid",
          "expected_approval_status": "Approved",
          "expected_journey_fingerprint": "sha256:885e6244bd1664dc64803034a1fc36e55ab56e9dda25424b5739b50fc9e445bd",
          "authorize_objective_proposal_apply": true,
          "authorization_preflight_continuation_id": "certify.positive.auth",
          "expected_authorization_preflight_decision_id": "headless_decision_2c561ffc576945e8b851d4a1ee2ae7bc",
          "expected_authorization_preflight_fingerprint": "sha256:5399cf71dee16fc42b623ece0767a40b97851f04aa2014896765584d8b1cb8b7",
          "expected_preflight_snapshot_id": "snapshot_6a7e02f00f4347e889dc02e31e00d0d8",
          "expected_apply_plan_id": "plan_29bbbf582d404c6486b713d897363e7f",
          "expected_target_sha256": "sha256:39cd28753247d164f4c7b85b3e1b9d32c29068b04cd860912674d04da21c7189",
          "patch_old_text": "original README",
          "patch_new_text": "new README content"
        }
      }
    },
    "response": {
      "jsonrpc": "2.0",
      "id": 7,
      "result": {
        "candidate_count": 1,
        "continuation_id": "certify.positive.apply",
        "current_aggregate_sequence": 20261117153348750,
        "current_progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
        "decision_id": "headless_decision_2c739d6b00ea407f9e589dcb17bb3371",
        "expected_aggregate_sequence": 20261117153348750,
        "expected_progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
        "next_action": "verify_objective_apply",
        "next_route": {
          "aggregate_sequence": 20261117153348750,
          "apply_fingerprint": "sha256:35c8ae21d2824261c2a00d68c5c83232c0e2d86385d36a5d74a0ddc4b9514fe1",
          "apply_id": "apply_a541e738bdcf49b4a32d7e9cbcddb75b",
          "kind": "verify_objective_apply_explicitly",
          "next_action": "verify_objective_apply",
          "progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
          "proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
          "reason": "Objective proposal apply completed with bounded apply result; verify the current target state.",
          "run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
          "task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130"
        },
        "post_aggregate_sequence": 20261117153348750,
        "post_progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
        "proposal_apply_result": {
          "apply_result": {
            "applied": true,
            "applied_at": "2026-11-17T15:33:48.93996Z",
            "apply_id": "apply_a541e738bdcf49b4a32d7e9cbcddb75b",
            "apply_reason": "Patch-file hunks applied and post-write SHA-256 verified.",
            "apply_status": "Applied",
            "atomic_create_completed": false,
            "atomic_delete_completed": false,
            "atomic_replacement_completed": true,
            "authorization_consumed": true,
            "authorization_id": "apply_auth_b836c212124b486aa1b30c3e9c8679e4",
            "blocked_checks": [],
            "check_count": 32,
            "checked_at": "2026-11-17T15:33:48.911868Z",
            "checklist": [
              {
                "name": "proposal_exists",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "one_time_apply_authorization",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "apply_time_write_workspace_permission",
                "reason": "Mode implementer allows workspace writes.",
                "status": "Pass"
              },
              {
                "name": "supported_operation",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "proposal_is_valid",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "proposal_is_approved",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "approval_not_expired",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "approval_unconsumed",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "patch_hunk_required",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "patch_hunk_bounded",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "patch_hunk_sensitive_scan",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "patch_hunk_matches_proposal",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "proposal_diff_available",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "approved_patch_metadata_matches",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "expected_target_hash_valid",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "latest_preflight_exists",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "latest_preflight_validation",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "target_path_safe",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "target_file_exists",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "target_file_regular",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "target_file_not_symlink",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "target_file_readable",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "expected_target_hash_matches",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "target_file_utf8",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "target_file_sensitive_scan",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "patch_hunk_context_matches",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "structured_content_parseable",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "todo_queue_post_apply_preflight",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "temporary_sibling_file_created",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "bounded_write_flushed_and_synced",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "atomic_replacement_completed",
                "reason": null,
                "status": "Pass"
              },
              {
                "name": "post_write_sha256_verified",
                "reason": null,
                "status": "Pass"
              }
            ],
            "content_bytes": 33,
            "content_chars": 33,
            "expected_target_absent": null,
            "expected_target_sha256": "sha256:39cd28753247d164f4c7b85b3e1b9d32c29068b04cd860912674d04da21c7189",
            "failed_checks": [],
            "operation": "patch_file",
            "path": "README.md",
            "post_delete_target_exists": null,
            "post_write_sha256": "sha256:77ce4e19e1a057f2077f39117af9605b4d3d634cc4d5800a1c7a4625354e90c2",
            "pre_write_target_exists": true,
            "pre_write_target_sha256": "sha256:39cd28753247d164f4c7b85b3e1b9d32c29068b04cd860912674d04da21c7189",
            "proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
            "temp_file_cleaned": true
          },
          "proposal": {
            "approval_reason": "headless objective proposal authorization preflight certify.positive.auth",
            "approval_reason_redacted": false,
            "approval_status": "Approved",
            "approved_at": "2026-11-17T15:33:48.858068Z",
            "content_chars": 33,
            "content_preview": "[patch_file single_hunk old_chars=15 new_chars=18]",
            "diff_preview": "# retained_diff_preview_sha256: sha256:1934d71ffe35ee5460cb8edc48fe969c641852225b7452bc2c911e5241f369a8\n[diff preview elided]\n",
            "diff_redacted": false,
            "diff_truncated": false,
            "hunk_count": 1,
            "hunk_fingerprint": "sha256:0dd407d119c4b272f5df05e7d1fe0253f2cd0d104f2b6f392165c8a94645c004",
            "latest_apply_plan": {
              "checklist": [
                {
                  "name": "proposal_exists",
                  "reason": null,
                  "status": "Pass"
                },
                {
                  "name": "proposal_is_valid",
                  "reason": null,
                  "status": "Pass"
                },
                {
                  "name": "proposal_is_approved",
                  "reason": null,
                  "status": "Pass"
                },
                {
                  "name": "target_path_safe",
                  "reason": null,
                  "status": "Pass"
                },
                {
                  "name": "target_file_exists",
                  "reason": null,
                  "status": "Pass"
                },
                {
                  "name": "target_file_regular",
                  "reason": null,
                  "status": "Pass"
                },
                {
                  "name": "target_file_utf8",
                  "reason": null,
                  "status": "Pass"
                },
                {
                  "name": "target_file_hash_captured",
                  "reason": null,
                  "status": "Pass"
                },
                {
                  "name": "proposal_not_stale",
                  "reason": null,
                  "status": "Pass"
                },
                {
                  "name": "diff_preview_available",
                  "reason": null,
                  "status": "Pass"
                },
                {
                  "name": "sensitive_content_not_detected",
                  "reason": null,
                  "status": "Pass"
                },
                {
                  "name": "apply_execution_available",
                  "reason": "Patch apply is available through proposal.apply.",
                  "status": "Pass"
                }
              ],
              "plan_id": "plan_29bbbf582d404c6486b713d897363e7f",
              "proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
              "status": "Ready"
            },
            "latest_snapshot": {
              "canonical_path_hash": "sha256:1dde41ac088bbd3aa28bb0130488f66fc163ea998391a78ecd3a30411b146e55",
              "captured_at": "2026-11-17T15:33:48.921143Z",
              "file_exists": true,
              "file_kind": "File",
              "file_modified_unix_ms": 1794929627762,
              "file_sha256": "sha256:39cd28753247d164f4c7b85b3e1b9d32c29068b04cd860912674d04da21c7189",
              "file_size_bytes": 15,
              "path": "README.md",
              "proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
              "snapshot_id": "snapshot_01cc3df5c21d4eb7b377465e1a44fe17",
              "stale": false,
              "stale_reason": null
            },
            "operation": "patch_file",
            "path": "README.md",
            "proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
            "rejected_at": null,
            "truncated": false,
            "validation_reason": null,
            "validation_status": "Valid"
          }
        },
        "replayed": false,
        "selected_run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
        "selected_task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130",
        "stale": false,
        "status": "task_executed",
        "task_run_result": null
      }
    }
  },
  {
    "started_at": "2026-11-17T15:33:49.572310+00:00",
    "observed_at": "2026-11-17T15:33:49.613089+00:00",
    "request": {
      "jsonrpc": "2.0",
      "id": 9,
      "method": "headless.continue_once",
      "params": {
        "authorize": true,
        "continuation_id": "certify.positive.verify",
        "expected_progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
        "expected_aggregate_sequence": 20261117153348750,
        "objective_apply_verification_target": {
          "journey_id": "certify.positive.journey",
          "session_id": "certify.positive",
          "source_drive_id": "certify.positive.drive",
          "expected_task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130",
          "expected_run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
          "expected_proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
          "expected_operation": "patch_file",
          "expected_path_fingerprint": "sha256:b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5",
          "authorize_objective_apply_verification": true,
          "objective_apply_continuation_id": "certify.positive.apply",
          "expected_objective_apply_decision_id": "headless_decision_2c739d6b00ea407f9e589dcb17bb3371",
          "expected_apply_id": "apply_a541e738bdcf49b4a32d7e9cbcddb75b",
          "expected_apply_status": "Applied",
          "expected_authorization_consumed": true,
          "expected_apply_fingerprint": "sha256:35c8ae21d2824261c2a00d68c5c83232c0e2d86385d36a5d74a0ddc4b9514fe1",
          "expected_post_write_sha256": "sha256:77ce4e19e1a057f2077f39117af9605b4d3d634cc4d5800a1c7a4625354e90c2"
        }
      }
    },
    "response": {
      "jsonrpc": "2.0",
      "id": 9,
      "result": {
        "candidate_count": 1,
        "continuation_id": "certify.positive.verify",
        "current_aggregate_sequence": 20261117153348750,
        "current_progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
        "decision_id": "headless_decision_3ea89c525d1849da9b46f5a6f67be7ee",
        "expected_aggregate_sequence": 20261117153348750,
        "expected_progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
        "next_action": "accept_objective_completion",
        "next_route": {
          "aggregate_sequence": 20261117153348750,
          "apply_fingerprint": "sha256:35c8ae21d2824261c2a00d68c5c83232c0e2d86385d36a5d74a0ddc4b9514fe1",
          "apply_id": "apply_a541e738bdcf49b4a32d7e9cbcddb75b",
          "kind": "accept_objective_completion_explicitly",
          "next_action": "accept_objective_completion",
          "progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
          "proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
          "reason": "Objective apply verification matched the current target hash; proceed to accepted completion boundary.",
          "run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
          "task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130"
        },
        "objective_apply_verification_result": {
          "apply_fingerprint": "sha256:35c8ae21d2824261c2a00d68c5c83232c0e2d86385d36a5d74a0ddc4b9514fe1",
          "apply_id": "apply_a541e738bdcf49b4a32d7e9cbcddb75b",
          "current_target_sha256": "sha256:77ce4e19e1a057f2077f39117af9605b4d3d634cc4d5800a1c7a4625354e90c2",
          "expected_post_write_sha256": "sha256:77ce4e19e1a057f2077f39117af9605b4d3d634cc4d5800a1c7a4625354e90c2",
          "journey_id": "certify.positive.journey",
          "next_action": "accept_objective_completion",
          "operation": "replace_file",
          "path_fingerprint": "sha256:b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5",
          "proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
          "replayed": false,
          "route_kind": "accept_objective_completion_explicitly",
          "run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
          "session_id": "certify.positive",
          "source_drive_id": "certify.positive.drive",
          "task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130",
          "verification_fingerprint": "sha256:89b711842ddd326ca0f4a58faa8f8569924e870762e6a9102169aeca5c3167d9",
          "verification_status": "verified"
        },
        "post_aggregate_sequence": 20261117153348750,
        "post_progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
        "replayed": false,
        "selected_run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
        "selected_task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130",
        "stale": false,
        "status": "task_executed",
        "task_run_result": null
      }
    }
  },
  {
    "started_at": "2026-11-17T15:33:49.615155+00:00",
    "observed_at": "2026-11-17T15:33:49.653006+00:00",
    "request": {
      "jsonrpc": "2.0",
      "id": 10,
      "method": "headless.continue_once",
      "params": {
        "authorize": true,
        "continuation_id": "certify.positive.complete",
        "expected_progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
        "expected_aggregate_sequence": 20261117153348750,
        "objective_completion_acceptance_target": {
          "journey_id": "certify.positive.journey",
          "session_id": "certify.positive",
          "source_drive_id": "certify.positive.drive",
          "expected_task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130",
          "expected_run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
          "expected_proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
          "expected_operation": "patch_file",
          "expected_path_fingerprint": "sha256:b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5",
          "expected_apply_id": "apply_a541e738bdcf49b4a32d7e9cbcddb75b",
          "expected_apply_status": "Applied",
          "expected_authorization_consumed": true,
          "expected_apply_fingerprint": "sha256:35c8ae21d2824261c2a00d68c5c83232c0e2d86385d36a5d74a0ddc4b9514fe1",
          "expected_post_write_sha256": "sha256:77ce4e19e1a057f2077f39117af9605b4d3d634cc4d5800a1c7a4625354e90c2",
          "authorize_objective_completion_acceptance": true,
          "objective_apply_verification_continuation_id": "certify.positive.verify",
          "expected_objective_apply_verification_decision_id": "headless_decision_3ea89c525d1849da9b46f5a6f67be7ee",
          "expected_current_target_sha256": "sha256:77ce4e19e1a057f2077f39117af9605b4d3d634cc4d5800a1c7a4625354e90c2",
          "expected_verification_status": "verified",
          "expected_verification_route_kind": "accept_objective_completion_explicitly",
          "expected_verification_fingerprint": "sha256:89b711842ddd326ca0f4a58faa8f8569924e870762e6a9102169aeca5c3167d9"
        }
      }
    },
    "response": {
      "jsonrpc": "2.0",
      "id": 10,
      "result": {
        "candidate_count": 1,
        "continuation_id": "certify.positive.complete",
        "current_aggregate_sequence": 20261117153348750,
        "current_progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
        "decision_id": "headless_decision_d752e8fa56c641e89b522839994c4639",
        "expected_aggregate_sequence": 20261117153348750,
        "expected_progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
        "next_action": "close_headless_run",
        "next_route": {
          "aggregate_sequence": 20261117153348750,
          "apply_fingerprint": "sha256:35c8ae21d2824261c2a00d68c5c83232c0e2d86385d36a5d74a0ddc4b9514fe1",
          "apply_id": "apply_a541e738bdcf49b4a32d7e9cbcddb75b",
          "kind": "refresh_progress_overview",
          "next_action": "close_headless_run",
          "progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
          "proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
          "reason": "Objective apply verification was accepted as completed; close the Golden Journey explicitly.",
          "run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
          "task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130"
        },
        "objective_completion_acceptance_result": {
          "acceptance_fingerprint": "sha256:2443a15f18bcbd441edf549bf140c32ec1091c09aae7278b945fc10640d11bdc",
          "acceptance_status": "accepted",
          "apply_fingerprint": "sha256:35c8ae21d2824261c2a00d68c5c83232c0e2d86385d36a5d74a0ddc4b9514fe1",
          "apply_id": "apply_a541e738bdcf49b4a32d7e9cbcddb75b",
          "current_target_sha256": "sha256:77ce4e19e1a057f2077f39117af9605b4d3d634cc4d5800a1c7a4625354e90c2",
          "expected_post_write_sha256": "sha256:77ce4e19e1a057f2077f39117af9605b4d3d634cc4d5800a1c7a4625354e90c2",
          "journey_id": "certify.positive.journey",
          "next_action": "close_headless_run",
          "operation": "replace_file",
          "path_fingerprint": "sha256:b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5",
          "proposal_id": "proposal_5095e2111dae4ce8b6a5f35682f23223",
          "replayed": false,
          "run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
          "session_id": "certify.positive",
          "source_drive_id": "certify.positive.drive",
          "task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130",
          "verification_fingerprint": "sha256:89b711842ddd326ca0f4a58faa8f8569924e870762e6a9102169aeca5c3167d9",
          "verification_status": "verified"
        },
        "post_aggregate_sequence": 20261117153348750,
        "post_progress_fingerprint": "sha256:c14c5e504f5e134fdfe7acfc0493e67f1f09f266d8278cb65583e96a74933736",
        "replayed": false,
        "selected_run_id": "run_ad50aa69-05da-42e6-9322-bfb6b2859b70",
        "selected_task_id": "task_15b7a67f-2da1-4987-973e-7e8ccc4de130",
        "stale": false,
        "status": "task_executed",
        "task_run_result": null
      }
    }
  }
];
