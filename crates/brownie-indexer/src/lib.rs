//! Codebase indexing crate.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexStage {
    Scan,
    Filter,
    Chunk,
    Embed,
    Write,
    Manifest,
}
