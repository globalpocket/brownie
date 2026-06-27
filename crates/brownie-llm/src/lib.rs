//! LLM client abstraction crate.

use serde::{Deserialize, Serialize};

pub const OPENAI_COMPATIBLE_API_VERSION: &str = "v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmRequest {
    pub model: String,
    pub messages: Vec<LlmMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmResponse {
    pub content: String,
}

pub struct FakeLlm;

impl FakeLlm {
    pub fn complete(request: &LlmRequest) -> LlmResponse {
        let prompt = request
            .messages
            .iter()
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>()
            .join("\n")
            .to_lowercase();
        let mut requests = vec![(
            "workspace.read",
            "Inspect workspace context before proceeding.",
        )];
        if contains_any(&prompt, &["implement", "edit", "修正", "実装"]) {
            requests.push(("workspace.write", "Need to edit workspace files."));
        }
        if contains_any(
            &prompt,
            &["test", "check", "verify", "検証", "テスト", "実行"],
        ) {
            requests.push(("process.exec", "Need to run verification commands."));
        }
        if prompt.contains("orchestrator") {
            requests.push((
                "subtask.spawn",
                "Orchestrator mode may coordinate subtasks.",
            ));
        }
        let tool_requests = requests
            .into_iter()
            .map(|(tool_id, reason)| serde_json::json!({ "tool_id": tool_id, "reason": reason }))
            .collect::<Vec<_>>();
        let intent = serde_json::json!({ "tool_requests": tool_requests });
        LlmResponse {
            content: format!(
                "Fake LLM completed request with {} messages.\n\n```brownie-tool-intent\n{}\n```",
                request.messages.len(),
                serde_json::to_string_pretty(&intent).expect("fake intent serializes")
            ),
        }
    }
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fake_llm_returns_deterministic_response() {
        let request = LlmRequest {
            model: "brownie-fake-llm".into(),
            messages: vec![
                LlmMessage {
                    role: "system".into(),
                    content: "system".into(),
                },
                LlmMessage {
                    role: "user".into(),
                    content: "user".into(),
                },
            ],
        };

        let content = FakeLlm::complete(&request).content;
        assert!(content.starts_with("Fake LLM completed request with 2 messages."));
        assert!(content.contains("```brownie-tool-intent"));
        assert!(content.contains("workspace.read"));
    }
}
