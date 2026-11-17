//! Shared typed provenance parser; metadata counts never wrap.
use brownie_protocol::RecoveryCycleChildProvenance;
use serde_json::Value;

pub(super) fn from_envelope(
    envelope_payload: &Value,
    maximum_depth: usize,
) -> anyhow::Result<Option<RecoveryCycleChildProvenance>> {
    let Some(parent_join_admission_id) =
        optional_non_empty_payload_string(envelope_payload, "parent_join_admission_id")?
    else {
        return Ok(None);
    };
    let parent_join_child_completion_fingerprint = required_non_empty_payload_string(
        envelope_payload,
        "parent_join_child_completion_fingerprint",
    )?;
    if !is_sha256_fingerprint(&parent_join_child_completion_fingerprint) {
        anyhow::bail!(
            "invalid recovery-cycle child provenance: parent_join_child_completion_fingerprint must be sha256:<64 lowercase hex>"
        );
    }

    let parent_join_child_completion_child_count =
        required_usize_payload(envelope_payload, "parent_join_child_completion_child_count")?;
    let parent_join_terminal_failed_child_count =
        required_usize_payload(envelope_payload, "parent_join_terminal_failed_child_count")?;
    let parent_join_terminal_completed_child_count = required_usize_payload(
        envelope_payload,
        "parent_join_terminal_completed_child_count",
    )?;
    if parent_join_terminal_failed_child_count
        .checked_add(parent_join_terminal_completed_child_count)
        != Some(parent_join_child_completion_child_count)
    {
        anyhow::bail!(
            "invalid recovery-cycle child provenance: terminal failed/completed counts must sum to child completion child count"
        );
    }

    let parent_join_recovery_cycle =
        required_bool_payload(envelope_payload, "parent_join_recovery_cycle")?;
    let parent_join_recovery_cycle_depth =
        required_usize_payload(envelope_payload, "parent_join_recovery_cycle_depth")?;
    if parent_join_recovery_cycle {
        if parent_join_recovery_cycle_depth == 0 {
            anyhow::bail!(
                "invalid recovery-cycle child provenance: recovery-cycle depth must be at least 1 when parent_join_recovery_cycle is true"
            );
        }
        if parent_join_recovery_cycle_depth > maximum_depth {
            anyhow::bail!(
                "invalid recovery-cycle child provenance: recovery-cycle depth exceeds runtime budget"
            );
        }
    } else {
        if parent_join_recovery_cycle_depth != 0 {
            anyhow::bail!(
                "invalid recovery-cycle child provenance: recovery-cycle depth must be 0 when parent_join_recovery_cycle is false"
            );
        }
        return Ok(None);
    }

    Ok(Some(RecoveryCycleChildProvenance {
        parent_join_admission_id,
        parent_join_child_completion_fingerprint,
        parent_join_child_completion_child_count,
        parent_join_terminal_failed_child_count,
        parent_join_terminal_completed_child_count,
        parent_join_recovery_cycle,
        parent_join_recovery_cycle_depth,
    }))
}

pub(super) fn optional_non_empty_payload_string(
    payload: &Value,
    key: &str,
) -> anyhow::Result<Option<String>> {
    let Some(value) = payload.get(key) else {
        return Ok(None);
    };
    let Some(value) = value.as_str() else {
        anyhow::bail!("invalid recovery-cycle child provenance: {key} must be a string");
    };
    if value.trim().is_empty() {
        anyhow::bail!("invalid recovery-cycle child provenance: {key} must be non-empty");
    }
    Ok(Some(value.to_string()))
}

pub(super) fn required_non_empty_payload_string(
    payload: &Value,
    key: &str,
) -> anyhow::Result<String> {
    optional_non_empty_payload_string(payload, key)?.ok_or_else(|| {
        anyhow::anyhow!("invalid recovery-cycle child provenance: missing required {key}")
    })
}

pub(super) fn required_bool_payload(payload: &Value, key: &str) -> anyhow::Result<bool> {
    payload.get(key).and_then(Value::as_bool).ok_or_else(|| {
        anyhow::anyhow!("invalid recovery-cycle child provenance: {key} must be a boolean")
    })
}

pub(super) fn required_usize_payload(payload: &Value, key: &str) -> anyhow::Result<usize> {
    usize::try_from(payload.get(key).and_then(Value::as_u64).ok_or_else(|| {
        anyhow::anyhow!(
            "invalid recovery-cycle child provenance: {key} must be a non-negative integer"
        )
    })?)
    .map_err(|_| anyhow::anyhow!("invalid recovery-cycle child provenance: {key} is too large"))
}

pub(super) fn is_sha256_fingerprint(value: &str) -> bool {
    let Some(hex) = value.strip_prefix("sha256:") else {
        return false;
    };
    hex.len() == 64
        && hex
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}
