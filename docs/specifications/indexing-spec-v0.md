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

## M9.1 Runtime File Inventory Slice

M9.1 implements the first executable indexer behavior: a runtime-owned
metadata-only workspace file inventory. The JSON-RPC method
`codebase.index.build` invokes `brownie-indexer` through the Rust runtime,
not the VSIX.

The M9.1 scanner:

- accepts only an optional workspace-relative root;
- rejects absolute roots and parent traversal before traversal;
- never follows symlinks;
- skips symlink files and directories;
- skips protected or generated components including `.git`, `.brownie`,
  `node_modules`, `target`, `dist`, `build`, `coverage`, `.next`, `out`, and
  `vendor`;
- indexes existing regular files only;
- classifies bounded entries as Rust, TypeScript, JavaScript, JSON, TOML,
  Markdown, YAML, Shell, Text, or Other;
- clamps caller-supplied file, directory, path-length, and per-file byte
  limits to runtime maxima;
- reads file bytes only transiently for SHA-256 change detection and UTF-8 line
  counts, then discards the bytes.

The persisted manifest lives under runtime-owned state:

```text
.brownie/
└─ codebase-index/
   ├─ current.json
   ├─ ledger.jsonl
   └─ snapshots/
      └─ <index_id>.json
```

Snapshots contain sorted metadata-only entries, counts, effective limits,
workspace and snapshot fingerprints, and truncation state. They must not
contain raw file content, snippets, diffs, absolute paths, canonical paths,
prompts, provider responses, stdout/stderr, environment values, commands, or
secrets.

The M9.1 ledger event is `CodebaseIndexSnapshotBuilt`. Its payload contains
only the index id, root, fingerprints, counts, limits, truncation state,
`force_refresh`, and `next_action`. It does not create embeddings, chunks,
Qdrant writes, retrieval results, shell/git/network execution, or workspace
mutation.
