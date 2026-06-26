//! llama-server wrapper crate.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LlamaServerMode {
    Managed,
    External,
}
