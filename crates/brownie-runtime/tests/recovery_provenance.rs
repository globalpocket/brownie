//! The exact production parser is compiled into this integration target.
#[path = "../src/recovery_provenance.rs"]
mod recovery_provenance;
use serde_json::{json, Value};
fn valid() -> Value {
    json!({"parent_join_admission_id":"owned_admission","parent_join_child_completion_fingerprint":format!("sha256:{}","a".repeat(64)),"parent_join_child_completion_child_count":3,"parent_join_terminal_failed_child_count":1,"parent_join_terminal_completed_child_count":2,"parent_join_recovery_cycle":true,"parent_join_recovery_cycle_depth":2})
}
#[test]
fn counts_reject_unsigned_overflow_without_panic_or_acceptance() {
    let mut value = valid();
    value["parent_join_child_completion_child_count"] = json!(0);
    value["parent_join_terminal_failed_child_count"] = json!(usize::MAX);
    value["parent_join_terminal_completed_child_count"] = json!(1);
    let result = std::panic::catch_unwind(|| recovery_provenance::from_envelope(&value, 2));
    assert!(
        matches!(result, Ok(Err(_))),
        "overflow must be a validation error: {result:?}"
    );
}
#[test]
fn valid_missing_and_malformed_controls_keep_their_contracts() {
    let accepted = recovery_provenance::from_envelope(&valid(), 2)
        .unwrap()
        .unwrap();
    assert_eq!(accepted.parent_join_child_completion_child_count, 3);
    assert!(recovery_provenance::from_envelope(&json!({}), 2)
        .unwrap()
        .is_none());
    let mut ordinary = valid();
    ordinary["parent_join_child_completion_child_count"] = json!(1);
    ordinary["parent_join_terminal_failed_child_count"] = json!(0);
    ordinary["parent_join_terminal_completed_child_count"] = json!(1);
    ordinary["parent_join_recovery_cycle"] = json!(false);
    ordinary["parent_join_recovery_cycle_depth"] = json!(0);
    assert!(recovery_provenance::from_envelope(&ordinary, 2)
        .unwrap()
        .is_none());
    for (key, input) in [
        ("parent_join_admission_id", json!(" ")),
        (
            "parent_join_child_completion_fingerprint",
            json!("not-sha256"),
        ),
        ("parent_join_terminal_failed_child_count", json!(4)),
        ("parent_join_child_completion_child_count", json!(-1)),
        ("parent_join_child_completion_child_count", json!(3.5)),
        ("parent_join_recovery_cycle_depth", json!(0)),
        ("parent_join_recovery_cycle_depth", json!(3)),
    ] {
        let mut value = valid();
        value[key] = input;
        assert!(
            recovery_provenance::from_envelope(&value, 2).is_err(),
            "{key}: {value}"
        );
    }
    let mut missing = valid();
    missing
        .as_object_mut()
        .unwrap()
        .remove("parent_join_recovery_cycle_depth");
    assert!(recovery_provenance::from_envelope(&missing, 2).is_err());
}
