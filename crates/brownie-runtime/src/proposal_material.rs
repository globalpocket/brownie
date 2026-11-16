//! Bounded request material for the current Runtime process only.
//! This module never writes a file and never reconstructs material from history.
use serde_json::Value;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const MAX_BYTES: usize = 1024 * 1024;
const MAX_PROPOSALS: usize = 64;

struct Entry {
    run_directory: PathBuf,
    proposal: String,
    material: Value,
    bytes: usize,
}

fn entries() -> &'static Mutex<VecDeque<Entry>> {
    static ENTRIES: OnceLock<Mutex<VecDeque<Entry>>> = OnceLock::new();
    ENTRIES.get_or_init(|| Mutex::new(VecDeque::new()))
}

pub(super) fn remember(run_directory: &Path, proposal: &str, material: Value) {
    let Ok(run_directory) = run_directory.canonicalize() else {
        return;
    };
    let bytes = material.to_string().len();
    if bytes > MAX_BYTES {
        return;
    }
    let Ok(mut entries) = entries().lock() else {
        return;
    };
    entries.retain(|entry| entry.run_directory != run_directory || entry.proposal != proposal);
    while entries.len() >= MAX_PROPOSALS
        || entries.iter().map(|e| e.bytes).sum::<usize>() + bytes > MAX_BYTES
    {
        entries.pop_front();
    }
    entries.push_back(Entry {
        run_directory,
        proposal: proposal.to_owned(),
        material,
        bytes,
    });
}

pub(super) fn for_request(run_directory: &Path, proposal: &str) -> Option<Value> {
    let run_directory = run_directory.canonicalize().ok()?;
    entries()
        .lock()
        .ok()?
        .iter()
        .find(|entry| entry.run_directory == run_directory && entry.proposal == proposal)
        .map(|entry| entry.material.clone())
}

/// Elide retained proposal/response text at the public boundary without changing
/// historical ledger bytes or the internal approval and apply verification data.
pub(super) fn elide_public_metadata(value: &mut Value) {
    match value {
        Value::Object(fields) => {
            // Retained responses lack a trustworthy indication that a short
            // preview was already partial. Never return all of that text.
            if matches!(
                fields.get("kind").and_then(Value::as_str),
                Some("LlmResponseReceived" | "SecondPassLlmResponseReceived")
            ) {
                if let Some(payload) = fields.get_mut("payload").and_then(Value::as_object_mut) {
                    if let Some(text) = payload.get("content_preview").and_then(Value::as_str) {
                        let limit = text.trim_end().chars().count().saturating_sub(1);
                        let partial = text.chars().take(limit).collect::<String>();
                        payload.insert("content_preview".into(), Value::String(partial));
                    }
                }
            }
            let proposal = fields.get("proposal_id").is_some_and(Value::is_string)
                && fields.get("content_chars").is_some_and(Value::is_number)
                && fields
                    .get("operation")
                    .and_then(Value::as_str)
                    .is_some_and(|op| {
                        matches!(
                            op,
                            "create_file" | "replace_file" | "delete_file" | "patch_file"
                        )
                    });
            if proposal {
                if matches!(
                    fields.get("operation").and_then(Value::as_str),
                    Some("create_file" | "replace_file")
                ) {
                    if let Some(content) = fields.get("content_preview").and_then(Value::as_str) {
                        if content != "[redacted]" {
                            let count = fields
                                .get("content_chars")
                                .and_then(Value::as_u64)
                                .unwrap_or(0);
                            fields.insert(
                                "content_preview".into(),
                                Value::String(format!("[proposal content elided; chars={count}]")),
                            );
                            fields.insert("truncated".into(), Value::Bool(true));
                        }
                    }
                }
                if let Some(diff) = fields.get("diff_preview").and_then(Value::as_str) {
                    fields.insert(
                        "diff_preview".into(),
                        Value::String(public_diff_preview(diff)),
                    );
                }
            }
            for key in [
                "content_preview",
                "output_preview",
                "completion_summary",
                "completion_summary_preview",
                "final_response_preview",
            ] {
                if fields.get(key).and_then(Value::as_str).is_some_and(|text| {
                    text.contains("brownie-tool-intent") || text.contains("\"tool_requests\"")
                }) {
                    fields.insert(
                        key.into(),
                        Value::String("[request-only tool intent elided]".into()),
                    );
                }
            }
            for child in fields.values_mut() {
                elide_public_metadata(child);
            }
        }
        Value::Array(children) => children.iter_mut().for_each(elide_public_metadata),
        _ => {}
    }
}

fn public_diff_preview(diff: &str) -> String {
    fn fingerprint(line: &str, prefix: &str) -> bool {
        line.strip_prefix(prefix)
            .is_some_and(super::is_sha256_fingerprint)
    }
    let lines = diff.lines().collect::<Vec<_>>();
    let content = lines
        .first()
        .copied()
        .filter(|line| fingerprint(line, "# proposed_content_sha256: "));
    let typed = match lines.as_slice() {
        [a, b, "[diff content elided]"] => {
            fingerprint(a, "# proposed_content_sha256: ")
                && fingerprint(b, "# approved_diff_sha256: ")
        }
        [a, b, "[diff preview elided]"] => {
            fingerprint(a, "# proposed_content_sha256: ")
                && fingerprint(b, "# retained_diff_preview_sha256: ")
        }
        [a, "[diff preview elided]"] => fingerprint(a, "# retained_diff_preview_sha256: "),
        _ => false,
    };
    if typed && diff.ends_with('\n') {
        return diff.to_owned();
    }
    let header = content.map(|line| format!("{line}\n")).unwrap_or_default();
    format!(
        "{header}# retained_diff_preview_sha256: sha256:{}\n[diff preview elided]\n",
        super::hex_sha256(diff.as_bytes())
    )
}

#[cfg(test)]
mod projection_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn marker_text_cannot_exempt_raw_material_from_public_elision() {
        for raw in [
            "RAW-MATERIAL\n[diff content elided]\n",
            "RAW-MATERIAL\n[patch hunk elided]\n",
            "# proposed_content_sha256: RAW-MATERIAL\n[diff content elided]\n",
        ] {
            let mut value = json!({"proposal":{"proposal_id":"p","operation":"create_file","content_chars":12,"content_preview":"RAW-MATERIAL","diff_preview":raw}});
            elide_public_metadata(&mut value);
            assert!(!value.to_string().contains("RAW-MATERIAL"));
            let once = value.clone();
            elide_public_metadata(&mut value);
            assert_eq!(value, once);
        }
    }
    #[test]
    fn exact_typed_fingerprints_and_explicit_request_material_are_preserved() {
        let diff = format!("# proposed_content_sha256: sha256:{}\n# approved_diff_sha256: sha256:{}\n[diff content elided]\n","a".repeat(64),"b".repeat(64));
        let mut value = json!({"proposal_id":"p","operation":"create_file","content_chars":12,"content_preview":"RAW-MATERIAL","diff_preview":diff,"replacement_content":"RAW-MATERIAL"});
        elide_public_metadata(&mut value);
        assert_eq!(value["diff_preview"], diff);
        assert_eq!(value["replacement_content"], "RAW-MATERIAL");
        assert!(!value["content_preview"]
            .as_str()
            .unwrap()
            .contains("RAW-MATERIAL"));
    }
}
