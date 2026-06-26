//! Brownie runtime entry points.

use brownie_protocol::{RuntimeState, RuntimeStatus};

pub fn runtime_status() -> RuntimeStatus {
    RuntimeStatus {
        name: "brownie-runtime".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        status: RuntimeState::Ready,
    }
}
