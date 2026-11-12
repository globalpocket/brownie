import { describe, expect, it } from 'vitest';
import { isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult as validate } from '../runtime/protocol';

const field = "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history";
const baseline = {
  "run_id": "synthetic_run",
  "history_status": "Complete",
  "history_reason": "synthetic",
  "report_count": 1,
  "latest_report": {
    "report_id": "synthetic_report_1",
    "report_status": "Complete",
    "history_status": "Complete",
    "digest_count": 1,
    "proposal_count": 1,
    "complete_count": 1,
    "needs_action_count": 0,
    "blocked_count": 0,
    "failed_check_count": 0,
    "blocked_check_count": 0,
    "required_next_action_count": 0,
    "required_next_actions": [],
    "apply_authorized": false,
    "generated_at": "2026-07-01T00:36:00Z"
  },
  "entries": [
    {
      "report_id": "synthetic_report_1",
      "report_status": "Complete",
      "history_status": "Complete",
      "digest_count": 1,
      "proposal_count": 1,
      "complete_count": 1,
      "needs_action_count": 0,
      "blocked_count": 0,
      "failed_check_count": 0,
      "blocked_check_count": 0,
      "required_next_action_count": 0,
      "required_next_actions": [],
      "apply_authorized": false,
      "generated_at": "2026-07-01T00:36:00Z"
    }
  ],
  "apply_authorized": false,
  "generated_at": "2026-07-01T00:37:00Z"
};

describe('bounded report history latest-entry consistency', () => {
  it('accepts a matching singleton and an empty history', () => {
    expect(validate({ [field]: structuredClone(baseline) })).toBe(true);
    expect(validate({ [field]: { ...baseline, report_count: 0, latest_report: null, entries: [] } })).toBe(true);
  });
  it('compares values independently of JSON property insertion order', () => {
    const reordered = Object.fromEntries(Object.entries(baseline.latest_report).reverse());
    expect(validate({ [field]: { ...baseline, latest_report: reordered } })).toBe(true);
  });
  it('rejects a different latest report even when both entries are individually valid', () => {
    expect(validate({ [field]: { ...baseline, latest_report: { ...baseline.latest_report, report_id: 'different' } } })).toBe(false);
  });
  it('rejects a missing latest report for a nonempty history', () => {
    expect(validate({ [field]: { ...baseline, latest_report: null } })).toBe(false);
  });
  it('rejects a latest report for an empty history', () => {
    expect(validate({ [field]: { ...baseline, report_count: 0, entries: [] } })).toBe(false);
  });
  it('retains authorization, raw-field and count refusals', () => {
    expect(validate({ [field]: { ...baseline, apply_authorized: true } })).toBe(false);
    expect(validate({ [field]: { ...baseline, latest_report: { ...baseline.latest_report, raw_input: 'private' } } })).toBe(false);
    expect(validate({ [field]: { ...baseline, report_count: 2 } })).toBe(false);
  });
});
