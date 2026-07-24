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
`requested_force_refresh`; no cache reuse exists yet.

## M9.2.1 Cross-Platform And Crash-Recovery Integrity

M9.2.1 corrects unresolved M9.2 review findings before ignore filtering or
query work. If the runtime platform lacks safe no-follow file reads, the index
build fails closed and does not commit a successful empty snapshot. The first
supported platform remains Unix; Windows indexing support requires a later
safe-handle implementation.

Directory traversal revalidates each queued directory immediately before
reading entries. A directory replaced by a symlink is skipped as a symlink, and a
queued directory whose canonical path no longer resolves inside the canonical
workspace root is skipped as unsafe before file reads.

Per-directory truncation remains memory-bounded and deterministic. The scanner
keeps the lexicographically smallest bounded entry set and traverses that sorted
set, instead of accepting whichever entries the filesystem enumerates first.

Index build locks include owner PID, creation time, nonce, and lock-file marker.
Active locks continue to serialize concurrent builds. A stale lock is reclaimable
only when the owner metadata is old enough, the owner process is not alive on
supported platforms, and the lock content is unchanged before removal.

## M9.3 Ignore-Aware Sensitive File Filtering

M9.3 makes `codebase.index.build` apply bounded ignore and sensitive-file
filtering before snapshot persistence. The runtime-owned indexer loads
workspace-root `.gitignore`, `.brownieignore`, and `.rooignore` files through the
same no-follow bounded file handles used for indexed files. Ignore policy files
must be regular UTF-8 files, are byte and rule-count bounded, and are rejected if
they are symlinks. Raw ignore patterns are not returned in RPC results or ledger
payloads.

Traversal checks ignore policy and sensitive path rules before regular-file
content reads. Sensitive path filtering skips common secret file names and key
extensions such as `.env`, `.npmrc`, `.pypirc`, `.netrc`, `id_rsa`,
`id_ed25519`, `credentials.json`, token/service-account JSON files, `.pem`,
`.key`, `.p12`, and `.pfx`. UTF-8 file content is scanned with the existing
bounded sensitive-content detector before content hashes are persisted. If
sensitive content is detected, the file is skipped and only numeric evidence is
recorded.

Snapshot counts and the `CodebaseIndexSnapshotBuilt` ledger payload include
`skipped_ignored`, `skipped_sensitive`, `ignore_rule_files_loaded`,
`ignore_rule_count`, and `sensitive_finding_count`. These counts are bounded
integers only; they must not include raw file content, raw ignore patterns,
matched secret values, absolute paths, or canonical paths. Snapshot
fingerprints include the new counts. Successful build results return
`next_action = "build_bounded_index_query_file_selection"` so headless callers
can proceed to the first bounded query/file-selection phase without inferring
that retrieval already exists.

M9.3 does not add a new RPC, readiness report, query API, chunking, embeddings,
Qdrant writes, retrieval, LLM provider execution, shell/git/network execution,
service control, or workspace mutation.
