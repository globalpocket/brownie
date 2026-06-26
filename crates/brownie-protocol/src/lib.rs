//! JSON-RPC protocol types for Brownie VSIX/runtime communication.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuntimeStatus {
    pub name: String,
    pub version: String,
    pub status: RuntimeState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RuntimeState {
    Ready,
    Starting,
    Stopping,
    Error,
}
