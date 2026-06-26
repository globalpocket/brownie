//! Brownie runtime event crate.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    Runtime,
    Task,
    Llm,
    Tool,
    File,
    Subtask,
    Index,
    ModePack,
}
