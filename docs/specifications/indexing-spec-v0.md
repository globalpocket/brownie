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

## M9.2 Containment And Permission Integrity

M9.2 hardens the existing `codebase.index.build` action before any query or
file-selection surface is added.

The runtime now requires `mode_id` and checks `RuntimeAction::IndexCodebase`
before scanning. The built-in `orchestrator` and `implementer` modes can build
the index; modes without `codebase_index` permission are denied before
traversal, snapshot replacement, or successful build evidence. Denied decisions
may append bounded `CodebaseIndexPermissionChecked` evidence, but they never
append `CodebaseIndexSnapshotBuilt`.

The scanner canonicalizes the workspace root, validates each requested root
component with `symlink_metadata`, rejects intermediate and final symlink
roots, canonicalizes the requested scan root, and requires the canonical scan
root to remain inside the canonical workspace root. Entries and ledger payloads
continue to expose only workspace-relative paths.

File fingerprinting and line counting use a bounded file-handle read path. On
Unix platforms, the runtime opens files with no-follow behavior, verifies the
opened handle metadata is still a regular file, then reads at most
`max_file_bytes + 1` bytes. Symlink swaps are skipped as symlinks, oversized
reads are skipped as too large, and raw bytes are discarded after computing
metadata.

Traversal includes two additional runtime-clamped limits:

- `max_visited_entries`, capped at `200000`;
- `max_directory_entries`, capped at `20000`.

Directory listing uses bounded memory and records `visited_entries` plus
`truncated_directories` in snapshot counts. Snapshot fingerprints include the
new counts and limits.

Snapshot persistence is serialized by `.brownie/codebase-index/build.lock`.
Committed builds write temporary sibling files, flush file contents, replace
snapshot/current files atomically, sync parent directories where supported, and
write `.brownie/codebase-index/commit.json` so the current snapshot can be
reconciled with the build ledger event. Stale temporary files with the runtime
temporary suffix are cleaned before a locked write. If ledger append fails, the
previous `current.json` remains authoritative.

`force_refresh` is currently a requested-only field. It is recorded as
`requested_force_refresh`; no cache reuse exists yet. Successful build results
return `next_action = "build_ignore_aware_sensitive_filtering"` so callers do
not infer query or context-planning support before later M9 phases.
