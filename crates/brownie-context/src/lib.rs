//! Context materialization and sliding window truncation crate.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextRegion {
    Protected,
    Recent,
    Truncatable,
}
