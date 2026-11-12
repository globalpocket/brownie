//! Test assertions inspect JSON structure rather than escaped serialized quotes.

pub(crate) trait JsonForbiddenLiteral {
    fn contains_forbidden_json_literal(&self, forbidden: &str) -> bool;
}

impl JsonForbiddenLiteral for str {
    fn contains_forbidden_json_literal(&self, forbidden: &str) -> bool {
        fn visit(value: &serde_json::Value, forbidden: &str) -> bool {
            match value {
                serde_json::Value::Object(fields) => fields
                    .iter()
                    .any(|(key, value)| key == forbidden || visit(value, forbidden)),
                serde_json::Value::Array(values) => {
                    values.iter().any(|value| visit(value, forbidden))
                }
                serde_json::Value::String(value) => value == forbidden,
                _ => false,
            }
        }
        let value = serde_json::from_str(self).expect("valid serialized test JSON");
        visit(&value, forbidden)
    }
}

#[test]
fn actual_keys_and_exact_content_values_cannot_pass_absence_check() {
    for forbidden in [
        "raw_input",
        "content",
        "canonical_path",
        "absolute_path",
        "stdout",
        "environment",
        "original README",
    ] {
        let object = serde_json::json!({forbidden: "SYNTHETIC"}).to_string();
        assert!(object.contains_forbidden_json_literal(forbidden));
        let string = serde_json::to_string(forbidden).unwrap();
        assert!(string.contains_forbidden_json_literal(forbidden));
    }
}

#[test]
fn nested_objects_and_arrays_cannot_hide_forbidden_fields() {
    let serialized = r#"{"safe":[{"nested":{"raw_input":"SYNTHETIC"}}]}"#;
    assert!(serialized.contains_forbidden_json_literal("raw_input"));
    let escaped = r#"{"safe":[{"raw_\u0069nput":"SYNTHETIC"}]}"#;
    assert!(escaped.contains_forbidden_json_literal("raw_input"));
}

#[test]
fn matching_substrings_and_quoted_text_are_not_object_keys() {
    let value = serde_json::json!({
        "canonical_path_hash": "sha256:abc",
        "summary": "text with \"raw_input\" mentioned",
        "metadata": [null, 1, true]
    })
    .to_string();
    assert!(!value.contains_forbidden_json_literal("canonical_path"));
    assert!(!value.contains_forbidden_json_literal("raw_input"));
}

#[test]
#[should_panic(expected = "valid serialized test JSON")]
fn malformed_serialization_fails_closed() {
    "not JSON".contains_forbidden_json_literal("raw_input");
}
