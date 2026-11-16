//! Redact recognized secrets at metadata storage and inspection boundaries.
//!
//! Identifiers, permission flags and source/result fingerprints retain their
//! original meaning. Raw proposal material is handled by its own contract.
use serde_json::Value;

pub(super) fn redact_text(text: &str) -> String {
    if brownie_llm::scan_text_for_sensitive_content(text)
        .findings
        .is_empty()
    {
        return text.to_string();
    }
    // Keep ordinary words (for example "flask-router") outside the provider
    // diagnostic redactor's deliberately broad token matching.
    let redacted = text
        .split_inclusive(char::is_whitespace)
        .map(|part| {
            if brownie_llm::scan_text_for_sensitive_content(part)
                .findings
                .is_empty()
            {
                part.to_string()
            } else {
                brownie_llm::redact_secret(part)
            }
        })
        .collect::<String>();
    // Some recognized forms span words or contain private-key bodies. Elide
    // the field if the existing value redactor cannot remove them safely.
    // A fixed redaction placeholder is not an original secret value.
    if !brownie_llm::scan_text_for_sensitive_content(&redacted.replace("[REDACTED]", "x"))
        .findings
        .is_empty()
    {
        "[sensitive metadata redacted]".to_string()
    } else {
        redacted
    }
}

pub(super) fn redact_payload(mut value: Value) -> Value {
    redact_fields(&mut value);
    value
}

pub(super) fn redact_response_payload(mut value: Value) -> Value {
    if let Some(preview) = value.get_mut("content_preview") {
        redact_text_values(preview);
    }
    redact_payload(value)
}

fn redact_text_values(value: &mut Value) {
    match value {
        Value::String(text) => *text = redact_text(text),
        Value::Array(values) => values.iter_mut().for_each(redact_text_values),
        _ => {}
    }
}

fn redact_fields(value: &mut Value) {
    match value {
        Value::Object(fields) => {
            for (key, value) in fields {
                match key.as_str() {
                    "role_definition"
                    | "display_name"
                    | "when_to_use"
                    | "description"
                    | "verification_responsibility"
                    | "completion_rules"
                    | "reason"
                    | "request_reason"
                    | "output_preview"
                    | "completion_summary"
                    | "completion_summary_preview"
                    | "final_response_preview" => redact_text_values(value),
                    "prompt_sections" => {
                        if let Value::Array(sections) = value {
                            for section in sections {
                                for field in ["title", "content"] {
                                    if let Some(text) = section.get_mut(field) {
                                        redact_text_values(text);
                                    }
                                }
                            }
                        }
                    }
                    _ => redact_fields(value),
                }
            }
        }
        Value::Array(values) => values.iter_mut().for_each(redact_fields),
        _ => {}
    }
}
