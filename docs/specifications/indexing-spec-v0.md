# Codebase Indexing Specification v0

## Purpose

Brownie includes a codebase indexing subsystem derived from Zoo Code behavior and reimplemented for Brownie's Rust architecture.

The indexer is separate from Qdrant lifecycle management.

## Ownership

- `brownie-indexer`: scans, filters, chunks, embeds, writes vectors, and serves retrieval.
- `brownie-qdrant`: manages Qdrant health, collections, and lifecycle.

## Pipeline

```text
WorkspaceScanner
  -> IgnoreResolver
  -> FileClassifier
  -> Chunker
  -> EmbeddingBatcher
  -> VectorWriter
  -> IndexManifest
```

## Ignore handling

The indexer should consider:

- `.gitignore`
- `.brownieignore`
- `.rooignore` compatibility
- dependency directories
- build output directories
- VCS metadata
- large files
- binary files
- generated files

## Batching

Embedding writes should use adaptive batching.

If a batch is too large, the indexer should retry with smaller batches and record failed chunks instead of discarding the whole index operation.

## Retrieval

Brownie retrieval must not be vector-only.

Initial retrieval should combine lexical search and vector search, then merge results with path and symbol boosting.

## Non-goals for v0

- Production reranker.
- Replacing Qdrant.
- Full language-server semantic indexing.
