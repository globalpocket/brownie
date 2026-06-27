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
        LlmResponse {
            content: format!(
                "Fake LLM completed request with {} messages.",
                request.messages.len()
            ),
        }
    }
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

        assert_eq!(
            FakeLlm::complete(&request).content,
            "Fake LLM completed request with 2 messages."
        );
    }
}
