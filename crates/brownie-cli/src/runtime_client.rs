use crate::cli::CliCommand;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeClient {
    boundary: RuntimeClientBoundary,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeClientBoundary {
    pub authority: RuntimeAuthority,
    pub transport: RuntimeTransport,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeAuthority {
    RustRuntime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeTransport {
    JsonRpcHostProcess,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeClientError {
    RuntimeUnavailable,
    CommunicationFailed,
}

impl Default for RuntimeClient {
    fn default() -> Self {
        Self {
            boundary: RuntimeClientBoundary {
                authority: RuntimeAuthority::RustRuntime,
                transport: RuntimeTransport::JsonRpcHostProcess,
            },
        }
    }
}

impl RuntimeClient {
    pub fn boundary(&self) -> &RuntimeClientBoundary {
        &self.boundary
    }

    pub fn invoke(&self, _command: &CliCommand) -> Result<String, RuntimeClientError> {
        Err(RuntimeClientError::RuntimeUnavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boundary_names_runtime_authority_without_policy_copy() {
        let client = RuntimeClient::default();
        assert_eq!(client.boundary().authority, RuntimeAuthority::RustRuntime);
        assert_eq!(
            client.boundary().transport,
            RuntimeTransport::JsonRpcHostProcess
        );
    }
}
