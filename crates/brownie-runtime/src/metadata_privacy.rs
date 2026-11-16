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
    let mut spans = Vec::new();
    let mut validation_spans = Vec::new();
    for kind in ["PRIVATE KEY", "OPENSSH PRIVATE KEY"] {
        let begin = format!("-----BEGIN {kind}-----");
        let end = format!("-----END {kind}-----");
        let mut offset = 0;
        while let Some(relative) = text[offset..].find(&begin) {
            let start = offset + relative;
            let finish = text[start + begin.len()..]
                .find(&end)
                .map(|position| start + begin.len() + position + end.len())
                .unwrap_or(text.len());
            spans.push((start, finish));
            validation_spans.push((start, finish));
            offset = finish;
        }
    }
    let mut previous = None;
    let mut line_is_blank = true;
    let mut boundaries = std::collections::HashMap::new();
    for (start, character) in text.char_indices() {
        let candidate = !character.is_ascii()
            || matches!(
                character.to_ascii_lowercase(),
                'a' | 'b' | 'c' | 'g' | 'p' | 's'
            );
        if candidate && metadata_word_boundary(previous, &mut boundaries) {
            for (prefix, minimum, hyphens) in [
                ("ghp_", 20, false),
                ("github_pat_", 20, false),
                ("sk-", 16, true),
            ] {
                if text[start..].starts_with(prefix) {
                    let value_start = start + prefix.len();
                    let length = text[value_start..]
                        .bytes()
                        .take_while(|c| {
                            c.is_ascii_alphanumeric() || *c == b'_' || (hyphens && *c == b'-')
                        })
                        .count();
                    if length >= minimum {
                        spans.push((start, value_start + length));
                        validation_spans.push((start, value_start + length));
                    }
                }
            }
            for name in [
                "api_key",
                "apikey",
                "api-key",
                "access_token",
                "access-token",
                "aws_secret_access_key",
                "secret_key",
                "client_secret",
                "password",
            ] {
                if let Some(end) = metadata_ci_prefix(text, start, name) {
                    let separator = metadata_skip_space(text, end);
                    if matches!(text.as_bytes().get(separator).copied(), Some(b':' | b'=')) {
                        if let Some(span) = metadata_assignment_value(text, separator + 1) {
                            spans.push(span);
                            validation_spans.push((start, span.1));
                        }
                    }
                }
            }
            if let Some(end) = metadata_ci_prefix(text, start, "bearer") {
                let value_start = metadata_skip_space(text, end);
                if value_start > end {
                    for (prefix, minimum, hyphens) in [
                        ("ghp_", 20, false),
                        ("github_pat_", 20, false),
                        ("sk-", 16, true),
                    ] {
                        if let Some(body_start) = metadata_ci_prefix(text, value_start, prefix) {
                            let mut count = 0;
                            let mut finish = body_start;
                            for character in text[body_start..].chars().take_while(|c| {
                                c.is_ascii_alphanumeric()
                                    || matches!(c, '_' | 'ſ' | 'K')
                                    || (hyphens && *c == '-')
                            }) {
                                count += 1;
                                finish += character.len_utf8();
                            }
                            if count >= minimum {
                                spans.push((value_start, finish));
                                validation_spans.push((start, finish));
                            }
                        }
                    }
                }
            }
            if line_is_blank {
                if let Some(end) = metadata_ci_prefix(text, start, "authorization") {
                    let separator = metadata_skip_space(text, end);
                    if text.as_bytes().get(separator) == Some(&b':') {
                        let bearer_start = metadata_skip_space(text, separator + 1);
                        if let Some(end) = metadata_ci_prefix(text, bearer_start, "bearer") {
                            let value_start = metadata_skip_space(text, end);
                            if value_start > end && value_start < text.len() {
                                let length = text[value_start..]
                                    .find(char::is_whitespace)
                                    .unwrap_or(text.len() - value_start);
                                spans.push((value_start, value_start + length));
                                validation_spans.push((start, value_start + length));
                            }
                        }
                    }
                }
            }
        }
        previous = Some(character);
        line_is_blank = character == '\n' || (line_is_blank && character.is_whitespace());
    }
    if spans.is_empty() {
        return "[sensitive metadata redacted]".to_string();
    }
    // Check the remainder with recognized expressions removed in a separate
    // validation view. Leaving an Authorization/assignment label beside a
    // placeholder would classify that placeholder or neighboring words again.
    let remaining = metadata_replace_spans(text, validation_spans);
    if !brownie_llm::scan_text_for_sensitive_content(&remaining)
        .findings
        .is_empty()
    {
        return "[sensitive metadata redacted]".to_string();
    }
    metadata_replace_spans(text, spans)
}

fn metadata_replace_spans(text: &str, mut spans: Vec<(usize, usize)>) -> String {
    spans.sort_unstable();
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (start, end) in spans {
        if let Some(last) = merged.last_mut().filter(|last| start <= last.1) {
            last.1 = last.1.max(end);
        } else {
            merged.push((start, end));
        }
    }
    let mut result = String::with_capacity(text.len());
    let mut cursor = 0;
    for (start, end) in merged {
        result.push_str(&text[cursor..start]);
        result.push_str("[REDACTED]");
        cursor = end;
    }
    result.push_str(&text[cursor..]);
    result
}

fn metadata_word_boundary(
    previous: Option<char>,
    cache: &mut std::collections::HashMap<char, bool>,
) -> bool {
    let Some(previous) = previous else {
        return true;
    };
    if previous.is_ascii() {
        return !previous.is_ascii_alphanumeric() && previous != '_';
    }
    // Ask the existing detector for its Unicode word-boundary behavior once
    // per preceding scalar. This probe has no assignment, so the existing
    // assignment-name regexes are not recompiled for response words.
    *cache.entry(previous).or_insert_with(|| {
        let probe = format!("{previous}sk-{}", "a".repeat(16));
        brownie_llm::scan_text_for_sensitive_content(&probe)
            .findings
            .iter()
            .any(|finding| finding.category == "openai_key_like")
    })
}

fn metadata_ci_prefix(text: &str, start: usize, prefix: &str) -> Option<usize> {
    let mut characters = text[start..].char_indices();
    let mut end = start;
    for expected in prefix.chars() {
        let (offset, actual) = characters.next()?;
        let equal = if actual.is_ascii() {
            actual.to_ascii_lowercase() == expected
        } else {
            let mut lower = actual.to_lowercase();
            let mut upper = actual.to_uppercase();
            (lower.next() == Some(expected) && lower.next().is_none())
                || (upper.next() == Some(expected.to_ascii_uppercase()) && upper.next().is_none())
        };
        if !equal {
            return None;
        }
        end = start + offset + actual.len_utf8();
    }
    Some(end)
}

fn metadata_skip_space(text: &str, mut start: usize) -> usize {
    while let Some(character) = text[start..].chars().next().filter(|c| c.is_whitespace()) {
        start += character.len_utf8();
    }
    start
}

fn metadata_assignment_value(text: &str, start: usize) -> Option<(usize, usize)> {
    let start = metadata_skip_space(text, start);
    let first = text[start..].chars().next()?;
    let (start, end) = if matches!(first, '"' | '\'') {
        let start = start + first.len_utf8();
        let mut escaped = false;
        let mut end = text.len();
        for (offset, character) in text[start..].char_indices() {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == first {
                end = start + offset;
                break;
            }
        }
        (start, end)
    } else {
        let length = text[start..]
            .find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | ',' | ';' | '&'))
            .unwrap_or(text.len() - start);
        (start, start + length)
    };
    (start < end).then_some((start, end))
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

#[cfg(test)]
mod span_tests {
    use super::*;
    const KEEP: &str = "Always run verification before completing. Use flask-router.";

    #[test]
    fn recognized_assignment_spellings_keep_adjacent_executable_instructions() {
        for name in [
            "api_key",
            "apikey",
            "api-key",
            "access_token",
            "access-token",
            "aws_secret_access_key",
            "secret_key",
            "client_secret",
            "password",
        ] {
            for value in [
                "fixture-secret-value",
                "\"fixture secret value\"",
                "'fixture secret value'",
            ] {
                let input = format!("{} : {value} {KEEP}", name.to_uppercase());
                assert!(!brownie_llm::scan_text_for_sensitive_content(&input)
                    .findings
                    .is_empty());
                let actual = redact_text(&input);
                assert!(!actual.contains("fixture"), "{name}: {actual}");
                assert!(actual.contains(KEEP), "{name}: {actual}");
            }
        }
    }

    #[test]
    fn token_header_and_private_blocks_preserve_neighboring_instructions() {
        let tokens = [
            format!("sk-{}", "a".repeat(24)),
            format!("ghp_{}", "b".repeat(24)),
            format!("github_pat_{}", "c".repeat(24)),
        ];
        for token in tokens {
            for input in [
                format!("{token} {KEEP}"),
                format!("  aUtHoRiZaTiOn : bEaReR {token}\n{KEEP}"),
            ] {
                let actual = redact_text(&input);
                assert!(!actual.contains(&token));
                assert!(actual.contains(KEEP));
            }
        }
        for kind in ["PRIVATE KEY", "OPENSSH PRIVATE KEY"] {
            let input = format!(
                "-----BEGIN {kind}-----\nfixture-private-body\n-----END {kind}-----\n{KEEP}"
            );
            let actual = redact_text(&input);
            assert!(!actual.contains("fixture-private-body"));
            assert!(actual.contains(KEEP));
        }
        let input = format!("Authorization: Bearer fixture-header-value\n{KEEP}");
        let actual = redact_text(&input);
        assert!(!actual.contains("fixture-header-value"));
        assert!(actual.contains(KEEP));
    }

    #[test]
    fn unicode_boundaries_and_case_folding_keep_benign_metadata() {
        let token = format!("sk-{}", "a".repeat(24));
        let benign = format!("a\u{0301}{}=benign-value", "password");
        let input = format!(
            "other=ordinary-value {benign} {token}。paſſword='unicode-secret-value' {KEEP}"
        );
        let actual = redact_text(&input);
        assert!(actual.contains(&benign), "{actual}");
        assert!(!actual.contains("unicode-secret-value"), "{actual}");
        assert!(!actual.contains(&token));
        assert!(actual.contains(KEEP));
        let input = format!("API_KEY=unicode-secret-value {KEEP}");
        let actual = redact_text(&input);
        assert!(!actual.contains("unicode-secret-value"));
        assert!(actual.contains(KEEP));
    }

    #[test]
    fn escaped_quotes_and_overlapping_spans_do_not_leave_secret_fragments() {
        let input = format!("{}=\"fixture-prefix\\\"fixture-tail\" {KEEP}", "password");
        let actual = redact_text(&input);
        assert!(!actual.contains("fixture"));
        assert!(actual.contains(KEEP));
        let token = format!("sk-{}", "a".repeat(24));
        let input = format!("{}={token}; {KEEP}", "api_key");
        let actual = redact_text(&input);
        assert_eq!(actual.matches("[REDACTED]").count(), 1);
        assert!(actual.contains(KEEP));
    }

    #[test]
    fn benign_fields_are_unchanged() {
        for text in [KEEP, "名前と本文を保持する。", "assignment=benign-value"] {
            assert_eq!(redact_text(text), text);
        }
    }

    #[test]
    fn mixed_assignment_and_case_folded_bearer_tokens_are_all_redacted() {
        for prefix in ["SK-", "GHP_", "GITHUB_PAT_"] {
            let token = format!("{prefix}{}", "a".repeat(24));
            let input = format!("{}=fixture-secret-value\nBearer {token}\n{KEEP}", "api_key");
            assert!(brownie_llm::scan_text_for_sensitive_content(&input)
                .findings
                .iter()
                .any(|finding| finding.category == "bearer_token"));
            let actual = redact_text(&input);
            assert!(!actual.contains(&token), "{actual}");
            assert!(!actual.contains("fixture-secret-value"), "{actual}");
            assert!(actual.contains(KEEP), "{actual}");
        }
    }
}
