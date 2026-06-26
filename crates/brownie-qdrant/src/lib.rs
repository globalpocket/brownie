//! Qdrant lifecycle and collection management crate.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QdrantMode {
    Managed,
    External,
}
