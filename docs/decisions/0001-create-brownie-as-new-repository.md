# ADR 0001: Create Brownie as a new repository

## Status

Accepted

## Context

Brownie needs to become the execution foundation for AgentModes-compatible autonomous development workflows on Code-OSS. Existing repositories provide useful references, but Brownie must avoid inheriting unrelated UI, account, and runtime coupling from Zoo Code or ZooCodeCustom.

## Decision

Brownie is created as a new repository: `globalpocket/brownie`.

Brownie is not a fork of Zoo Code or ZooCodeCustom. Zoo Code OSS and ZooCodeCustom are reference sources for selected behavior and wrappers only. AgentModes remains an external Mode Pack and compatibility target.

## Consequences

- Brownie can define its own Rust runtime architecture.
- Brownie can keep the VSIX layer thin.
- Brownie must document any behavior migrated from reference repositories.
- Brownie must avoid source-level copying unless licensing and attribution are explicitly reviewed.
