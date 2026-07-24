//! Codebase indexing crate.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use thiserror::Error;

pub const DEFAULT_MAX_INDEXED_FILES: usize = 10_000;
pub const DEFAULT_MAX_WALKED_DIRECTORIES: usize = 2_000;
pub const DEFAULT_MAX_PATH_CHARS: usize = 512;
pub const DEFAULT_MAX_FILE_BYTES: u64 = 1_048_576;
pub const DEFAULT_MAX_VISITED_ENTRIES: usize = 100_000;
pub const DEFAULT_MAX_DIRECTORY_ENTRIES: usize = 10_000;
pub const HARD_MAX_INDEXED_FILES: usize = 20_000;
pub const HARD_MAX_WALKED_DIRECTORIES: usize = 5_000;
pub const HARD_MAX_PATH_CHARS: usize = 1_024;
pub const HARD_MAX_FILE_BYTES: u64 = 2_097_152;
pub const HARD_MAX_VISITED_ENTRIES: usize = 200_000;
pub const HARD_MAX_DIRECTORY_ENTRIES: usize = 20_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexStage {
    Scan,
    Filter,
    Chunk,
    Embed,
    Write,
    Manifest,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CodebaseIndexBuildOptions {
    pub root: Option<String>,
    pub max_files: Option<usize>,
    pub max_directories: Option<usize>,
    pub max_path_chars: Option<usize>,
    pub max_file_bytes: Option<u64>,
    pub max_visited_entries: Option<usize>,
    pub max_directory_entries: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodebaseIndexSnapshot {
    pub index_id: String,
    pub root: String,
    pub workspace_fingerprint: String,
    pub snapshot_fingerprint: String,
    pub counts: CodebaseIndexCounts,
    pub limits: CodebaseIndexLimits,
    pub truncated: bool,
    pub entries: Vec<CodebaseIndexFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct CodebaseIndexCounts {
    pub indexed_files: usize,
    pub walked_directories: usize,
    pub skipped_protected: usize,
    pub skipped_symlink: usize,
    pub skipped_too_large: usize,
    pub skipped_binary_like: usize,
    pub skipped_unreadable: usize,
    pub skipped_unsafe_path: usize,
    pub skipped_other: usize,
    pub truncated_entries: usize,
    pub visited_entries: usize,
    pub truncated_directories: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodebaseIndexLimits {
    pub max_files: usize,
    pub max_directories: usize,
    pub max_path_chars: usize,
    pub max_file_bytes: u64,
    pub max_visited_entries: usize,
    pub max_directory_entries: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodebaseIndexFileEntry {
    pub path: String,
    pub file_kind: CodebaseIndexFileKind,
    pub byte_length: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum CodebaseIndexFileKind {
    Rust,
    TypeScript,
    JavaScript,
    Json,
    Toml,
    Markdown,
    Yaml,
    Shell,
    Text,
    Other,
}

#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum CodebaseIndexError {
    #[error("unsafe root: {0}")]
    UnsafeRoot(String),
    #[error("workspace root is unreadable")]
    WorkspaceRootUnreadable,
}

pub fn build_workspace_file_inventory(
    workspace_root: impl AsRef<Path>,
    options: CodebaseIndexBuildOptions,
) -> Result<CodebaseIndexSnapshot, CodebaseIndexError> {
    let workspace_root = workspace_root.as_ref();
    let limits = limits_from_options(&options);
    let root = resolve_safe_root(options.root.as_deref(), &limits)?;
    let canonical_workspace_root = workspace_root
        .canonicalize()
        .map_err(|_| CodebaseIndexError::WorkspaceRootUnreadable)?;
    validate_requested_root_components(&canonical_workspace_root, &root)?;
    let scan_root = canonical_workspace_root.join(root.as_path());
    let canonical_scan_root = scan_root
        .canonicalize()
        .map_err(|_| CodebaseIndexError::WorkspaceRootUnreadable)?;
    if !canonical_scan_root.starts_with(&canonical_workspace_root) {
        return Err(CodebaseIndexError::UnsafeRoot(
            "canonical root escapes workspace".to_string(),
        ));
    }

    let root_metadata = fs::symlink_metadata(&canonical_scan_root)
        .map_err(|_| CodebaseIndexError::WorkspaceRootUnreadable)?;
    if root_metadata.file_type().is_symlink() {
        return Err(CodebaseIndexError::UnsafeRoot(
            "root must not be a symlink".to_string(),
        ));
    }
    if !root_metadata.is_dir() {
        return Err(CodebaseIndexError::UnsafeRoot(
            "root must be an existing directory".to_string(),
        ));
    }

    let mut counts = CodebaseIndexCounts::default();
    let mut entries = Vec::new();
    let mut queue = VecDeque::from([(canonical_scan_root, root.clone())]);
    let mut truncated = false;

    'walk: while let Some((directory, relative_directory)) = queue.pop_front() {
        if counts.walked_directories >= limits.max_directories {
            truncated = true;
            counts.truncated_entries += 1;
            break;
        }
        counts.walked_directories += 1;

        let (children, directory_truncated) =
            match sorted_directory_entries(&directory, limits.max_directory_entries) {
                Ok(children) => children,
                Err(_) => {
                    counts.skipped_unreadable += 1;
                    continue;
                }
            };
        if directory_truncated {
            truncated = true;
            counts.truncated_directories += 1;
            counts.truncated_entries += 1;
        }

        for child in children {
            if counts.visited_entries >= limits.max_visited_entries {
                truncated = true;
                counts.truncated_entries += 1;
                break 'walk;
            }
            counts.visited_entries += 1;

            let child_path = child.path();
            if !child_path.starts_with(&canonical_workspace_root) {
                counts.skipped_unsafe_path += 1;
                continue;
            }

            let name = child.file_name();
            let child_relative = relative_directory.join(&name);
            let Some(relative_path) = workspace_relative_path(&child_relative) else {
                counts.skipped_unsafe_path += 1;
                continue;
            };

            if relative_path.chars().count() > limits.max_path_chars {
                counts.skipped_unsafe_path += 1;
                continue;
            }

            let metadata = match fs::symlink_metadata(&child_path) {
                Ok(metadata) => metadata,
                Err(_) => {
                    counts.skipped_unreadable += 1;
                    continue;
                }
            };
            let file_type = metadata.file_type();

            if file_type.is_symlink() {
                counts.skipped_symlink += 1;
                continue;
            }

            if file_type.is_dir() {
                if is_protected_or_generated_component(&name) {
                    counts.skipped_protected += 1;
                    continue;
                }
                queue.push_back((child_path, child_relative));
                continue;
            }

            if !file_type.is_file() {
                counts.skipped_other += 1;
                continue;
            }

            if entries.len() >= limits.max_files {
                truncated = true;
                counts.truncated_entries += 1;
                continue;
            }

            let file_read = match read_regular_file_no_follow(&child_path, limits.max_file_bytes) {
                Ok(read) => read,
                Err(FileReadError::Symlink) => {
                    counts.skipped_symlink += 1;
                    continue;
                }
                Err(FileReadError::NotRegularFile) => {
                    counts.skipped_other += 1;
                    continue;
                }
                Err(FileReadError::TooLarge) => {
                    counts.skipped_too_large += 1;
                    continue;
                }
                Err(FileReadError::Unreadable) => {
                    counts.skipped_unreadable += 1;
                    continue;
                }
                #[cfg(not(unix))]
                Err(FileReadError::UnsupportedNoFollow) => {
                    counts.skipped_unreadable += 1;
                    continue;
                }
            };

            let bytes = file_read.bytes;

            if bytes.contains(&0) {
                counts.skipped_binary_like += 1;
                continue;
            }

            let line_count = std::str::from_utf8(&bytes)
                .ok()
                .map(|text| text.lines().count());

            entries.push(CodebaseIndexFileEntry {
                file_kind: classify_file(&relative_path),
                path: relative_path,
                byte_length: file_read.byte_length,
                line_count,
                content_sha256: Some(sha256_fingerprint(&bytes)),
            });
        }
    }

    entries.sort_by(|a, b| {
        a.path
            .cmp(&b.path)
            .then_with(|| a.file_kind.cmp(&b.file_kind))
            .then_with(|| a.byte_length.cmp(&b.byte_length))
    });
    counts.indexed_files = entries.len();

    let workspace_fingerprint = workspace_fingerprint(&entries);
    let snapshot_fingerprint = snapshot_fingerprint(&root, &entries, &counts, &limits, truncated);
    let index_id = format!(
        "idx_{}",
        snapshot_fingerprint
            .strip_prefix("sha256:")
            .unwrap_or(&snapshot_fingerprint)
            .chars()
            .take(16)
            .collect::<String>()
    );

    Ok(CodebaseIndexSnapshot {
        index_id,
        root: workspace_relative_path(&root).unwrap_or_else(|| ".".to_string()),
        workspace_fingerprint,
        snapshot_fingerprint,
        counts,
        limits,
        truncated,
        entries,
    })
}

fn limits_from_options(options: &CodebaseIndexBuildOptions) -> CodebaseIndexLimits {
    CodebaseIndexLimits {
        max_files: clamp_usize(
            options.max_files,
            DEFAULT_MAX_INDEXED_FILES,
            1,
            HARD_MAX_INDEXED_FILES,
        ),
        max_directories: clamp_usize(
            options.max_directories,
            DEFAULT_MAX_WALKED_DIRECTORIES,
            1,
            HARD_MAX_WALKED_DIRECTORIES,
        ),
        max_path_chars: clamp_usize(
            options.max_path_chars,
            DEFAULT_MAX_PATH_CHARS,
            32,
            HARD_MAX_PATH_CHARS,
        ),
        max_file_bytes: clamp_u64(
            options.max_file_bytes,
            DEFAULT_MAX_FILE_BYTES,
            1,
            HARD_MAX_FILE_BYTES,
        ),
        max_visited_entries: clamp_usize(
            options.max_visited_entries,
            DEFAULT_MAX_VISITED_ENTRIES,
            1,
            HARD_MAX_VISITED_ENTRIES,
        ),
        max_directory_entries: clamp_usize(
            options.max_directory_entries,
            DEFAULT_MAX_DIRECTORY_ENTRIES,
            1,
            HARD_MAX_DIRECTORY_ENTRIES,
        ),
    }
}

fn clamp_usize(value: Option<usize>, default: usize, min: usize, max: usize) -> usize {
    value.unwrap_or(default).clamp(min, max)
}

fn clamp_u64(value: Option<u64>, default: u64, min: u64, max: u64) -> u64 {
    value.unwrap_or(default).clamp(min, max)
}

fn resolve_safe_root(
    root: Option<&str>,
    limits: &CodebaseIndexLimits,
) -> Result<PathBuf, CodebaseIndexError> {
    let Some(root) = root else {
        return Ok(PathBuf::new());
    };
    if root.trim().is_empty() || root == "." {
        return Ok(PathBuf::new());
    }
    if root.chars().count() > limits.max_path_chars {
        return Err(CodebaseIndexError::UnsafeRoot(
            "root path exceeds max_path_chars".to_string(),
        ));
    }
    if Path::new(root).is_absolute() {
        return Err(CodebaseIndexError::UnsafeRoot(
            "absolute roots are rejected".to_string(),
        ));
    }

    let mut normalized = PathBuf::new();
    for component in Path::new(root).components() {
        match component {
            Component::Normal(part) => {
                if is_protected_or_generated_component(part) {
                    return Err(CodebaseIndexError::UnsafeRoot(format!(
                        "protected root component rejected: {}",
                        part.to_string_lossy()
                    )));
                }
                normalized.push(part);
            }
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(CodebaseIndexError::UnsafeRoot(
                    "parent traversal is rejected".to_string(),
                ));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(CodebaseIndexError::UnsafeRoot(
                    "absolute roots are rejected".to_string(),
                ));
            }
        }
    }

    Ok(normalized)
}

fn validate_requested_root_components(
    canonical_workspace_root: &Path,
    root: &Path,
) -> Result<(), CodebaseIndexError> {
    let mut current = canonical_workspace_root.to_path_buf();
    for component in root.components() {
        let Component::Normal(part) = component else {
            continue;
        };
        current.push(part);
        let metadata = fs::symlink_metadata(&current)
            .map_err(|_| CodebaseIndexError::WorkspaceRootUnreadable)?;
        if metadata.file_type().is_symlink() {
            return Err(CodebaseIndexError::UnsafeRoot(
                "root path components must not be symlinks".to_string(),
            ));
        }
    }
    Ok(())
}

fn sorted_directory_entries(
    directory: &Path,
    max_directory_entries: usize,
) -> std::io::Result<(Vec<fs::DirEntry>, bool)> {
    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in fs::read_dir(directory)? {
        if entries.len() >= max_directory_entries {
            truncated = true;
            break;
        }
        entries.push(entry?);
    }
    entries.sort_by(|a, b| compare_os_names(&a.file_name(), &b.file_name()));
    Ok((entries, truncated))
}

#[derive(Debug)]
struct FileRead {
    bytes: Vec<u8>,
    byte_length: u64,
}

#[derive(Debug)]
enum FileReadError {
    Symlink,
    NotRegularFile,
    TooLarge,
    Unreadable,
    #[cfg(not(unix))]
    UnsupportedNoFollow,
}

#[cfg(unix)]
fn read_regular_file_no_follow(
    path: &Path,
    max_file_bytes: u64,
) -> Result<FileRead, FileReadError> {
    use std::os::unix::fs::OpenOptionsExt;

    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|error| match error.raw_os_error() {
            Some(code) if code == libc::ELOOP => FileReadError::Symlink,
            _ => FileReadError::Unreadable,
        })?;
    read_bounded_regular_handle(file, max_file_bytes)
}

#[cfg(not(unix))]
fn read_regular_file_no_follow(
    _path: &Path,
    _max_file_bytes: u64,
) -> Result<FileRead, FileReadError> {
    Err(FileReadError::UnsupportedNoFollow)
}

fn read_bounded_regular_handle(
    mut file: File,
    max_file_bytes: u64,
) -> Result<FileRead, FileReadError> {
    let metadata = file.metadata().map_err(|_| FileReadError::Unreadable)?;
    if !metadata.is_file() {
        return Err(FileReadError::NotRegularFile);
    }
    if metadata.len() > max_file_bytes {
        return Err(FileReadError::TooLarge);
    }

    let max_read = max_file_bytes
        .checked_add(1)
        .ok_or(FileReadError::TooLarge)?;
    let mut bytes = Vec::new();
    file.by_ref()
        .take(max_read)
        .read_to_end(&mut bytes)
        .map_err(|_| FileReadError::Unreadable)?;
    if bytes.len() as u64 > max_file_bytes {
        return Err(FileReadError::TooLarge);
    }

    Ok(FileRead {
        byte_length: bytes.len() as u64,
        bytes,
    })
}

fn compare_os_names(a: &std::ffi::OsStr, b: &std::ffi::OsStr) -> Ordering {
    a.to_string_lossy().cmp(&b.to_string_lossy())
}

fn workspace_relative_path(path: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    if parts.is_empty() {
        Some(".".to_string())
    } else {
        Some(parts.join("/"))
    }
}

fn is_protected_or_generated_component(component: &std::ffi::OsStr) -> bool {
    matches!(
        component.to_string_lossy().as_ref(),
        ".git"
            | ".brownie"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | "coverage"
            | ".next"
            | "out"
            | "vendor"
    )
}

fn classify_file(path: &str) -> CodebaseIndexFileKind {
    let lower = path.to_ascii_lowercase();
    let file_name = lower.rsplit('/').next().unwrap_or(lower.as_str());
    match file_name {
        "cargo.toml" => return CodebaseIndexFileKind::Toml,
        "readme" | "license" | "notice" => return CodebaseIndexFileKind::Text,
        _ => {}
    }
    match lower.rsplit('.').next() {
        Some("rs") => CodebaseIndexFileKind::Rust,
        Some("ts") | Some("tsx") => CodebaseIndexFileKind::TypeScript,
        Some("js") | Some("jsx") | Some("mjs") | Some("cjs") => CodebaseIndexFileKind::JavaScript,
        Some("json") | Some("jsonc") => CodebaseIndexFileKind::Json,
        Some("toml") => CodebaseIndexFileKind::Toml,
        Some("md") | Some("markdown") => CodebaseIndexFileKind::Markdown,
        Some("yaml") | Some("yml") => CodebaseIndexFileKind::Yaml,
        Some("sh") | Some("bash") | Some("zsh") => CodebaseIndexFileKind::Shell,
        Some("txt") => CodebaseIndexFileKind::Text,
        _ => CodebaseIndexFileKind::Other,
    }
}

fn workspace_fingerprint(entries: &[CodebaseIndexFileEntry]) -> String {
    let mut inputs = Vec::with_capacity(entries.len() + 1);
    inputs.push("workspace_file_inventory_entries_v1".to_string());
    for entry in entries {
        inputs.push(format!(
            "{}\t{:?}\t{}\t{}\t{}",
            entry.path,
            entry.file_kind,
            entry.byte_length,
            entry
                .line_count
                .map_or_else(String::new, |count| count.to_string()),
            entry.content_sha256.as_deref().unwrap_or("")
        ));
    }
    sha256_fingerprint(inputs.join("\n").as_bytes())
}

fn snapshot_fingerprint(
    root: &Path,
    entries: &[CodebaseIndexFileEntry],
    counts: &CodebaseIndexCounts,
    limits: &CodebaseIndexLimits,
    truncated: bool,
) -> String {
    let mut inputs = vec![
        "codebase_index_snapshot_v1".to_string(),
        format!(
            "root={}",
            workspace_relative_path(root).unwrap_or_else(|| ".".to_string())
        ),
        format!("truncated={truncated}"),
        format!(
            "counts={} {} {} {} {} {} {} {} {} {} {} {}",
            counts.indexed_files,
            counts.walked_directories,
            counts.skipped_protected,
            counts.skipped_symlink,
            counts.skipped_too_large,
            counts.skipped_binary_like,
            counts.skipped_unreadable,
            counts.skipped_unsafe_path,
            counts.skipped_other,
            counts.truncated_entries,
            counts.visited_entries,
            counts.truncated_directories
        ),
        format!(
            "limits={} {} {} {} {} {}",
            limits.max_files,
            limits.max_directories,
            limits.max_path_chars,
            limits.max_file_bytes,
            limits.max_visited_entries,
            limits.max_directory_entries
        ),
    ];
    for entry in entries {
        inputs.push(format!(
            "{}\t{:?}\t{}\t{}\t{}",
            entry.path,
            entry.file_kind,
            entry.byte_length,
            entry
                .line_count
                .map_or_else(String::new, |count| count.to_string()),
            entry.content_sha256.as_deref().unwrap_or("")
        ));
    }
    sha256_fingerprint(inputs.join("\n").as_bytes())
}

fn sha256_fingerprint(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn write_file(root: &Path, path: &str, content: &[u8]) {
        let target = root.join(path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        let mut file = fs::File::create(target).expect("create file");
        file.write_all(content).expect("write file");
    }

    fn entry<'a>(snapshot: &'a CodebaseIndexSnapshot, path: &str) -> &'a CodebaseIndexFileEntry {
        snapshot
            .entries
            .iter()
            .find(|entry| entry.path == path)
            .expect("entry")
    }

    #[test]
    fn builds_sorted_metadata_only_file_inventory() {
        let temp = tempfile::tempdir().expect("tempdir");
        write_file(
            temp.path(),
            "src/lib.rs",
            b"pub fn answer() -> u8 {\n    42\n}\n",
        );
        write_file(
            temp.path(),
            "Cargo.toml",
            b"[package]\nname = \"fixture\"\n",
        );
        write_file(temp.path(), "README.md", b"# Fixture\n");
        write_file(temp.path(), "package.json", br#"{"name":"fixture"}"#);
        write_file(temp.path(), "web/app.ts", b"export const ok = true;\n");

        let snapshot = build_workspace_file_inventory(
            temp.path(),
            CodebaseIndexBuildOptions {
                max_files: Some(20),
                ..Default::default()
            },
        )
        .expect("snapshot");

        let paths = snapshot
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            paths,
            vec![
                "Cargo.toml",
                "README.md",
                "package.json",
                "src/lib.rs",
                "web/app.ts"
            ]
        );
        assert_eq!(
            entry(&snapshot, "src/lib.rs").file_kind,
            CodebaseIndexFileKind::Rust
        );
        assert_eq!(
            entry(&snapshot, "web/app.ts").file_kind,
            CodebaseIndexFileKind::TypeScript
        );
        assert_eq!(entry(&snapshot, "README.md").line_count, Some(1));
        assert!(entry(&snapshot, "Cargo.toml")
            .content_sha256
            .as_ref()
            .is_some_and(|hash| hash.starts_with("sha256:")));
        assert!(snapshot.snapshot_fingerprint.starts_with("sha256:"));
        assert!(snapshot.workspace_fingerprint.starts_with("sha256:"));
    }

    #[test]
    fn skips_protected_directories_and_oversized_or_binary_files() {
        let temp = tempfile::tempdir().expect("tempdir");
        write_file(temp.path(), "src/lib.rs", b"pub fn ok() {}\n");
        write_file(temp.path(), ".git/config", b"secret-ish");
        write_file(temp.path(), ".brownie/current.json", b"state");
        write_file(temp.path(), "node_modules/pkg/index.js", b"module");
        write_file(temp.path(), "target/debug/app", b"binary");
        write_file(temp.path(), "big.txt", b"012345678901234567890");
        write_file(temp.path(), "image.bin", b"a\0b");

        let snapshot = build_workspace_file_inventory(
            temp.path(),
            CodebaseIndexBuildOptions {
                max_file_bytes: Some(20),
                ..Default::default()
            },
        )
        .expect("snapshot");

        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].path, "src/lib.rs");
        assert_eq!(snapshot.counts.skipped_protected, 4);
        assert_eq!(snapshot.counts.skipped_too_large, 1);
        assert_eq!(snapshot.counts.skipped_binary_like, 1);
        assert!(!snapshot
            .entries
            .iter()
            .any(|entry| entry.path.contains(".git") || entry.path.contains("node_modules")));
    }

    #[test]
    fn rejects_absolute_and_parent_traversal_roots() {
        let temp = tempfile::tempdir().expect("tempdir");
        let parent = build_workspace_file_inventory(
            temp.path(),
            CodebaseIndexBuildOptions {
                root: Some("../outside".to_string()),
                ..Default::default()
            },
        );
        assert!(matches!(parent, Err(CodebaseIndexError::UnsafeRoot(_))));

        let absolute = build_workspace_file_inventory(
            temp.path(),
            CodebaseIndexBuildOptions {
                root: Some(temp.path().to_string_lossy().to_string()),
                ..Default::default()
            },
        );
        assert!(matches!(absolute, Err(CodebaseIndexError::UnsafeRoot(_))));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_requested_roots_with_intermediate_symlink_components() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("tempdir");
        let outside = tempfile::tempdir().expect("outside");
        fs::create_dir_all(outside.path().join("src")).expect("outside src");
        write_file(outside.path(), "src/secret.rs", b"pub fn secret() {}\n");
        symlink(outside.path(), temp.path().join("linked")).expect("root symlink");

        let result = build_workspace_file_inventory(
            temp.path(),
            CodebaseIndexBuildOptions {
                root: Some("linked/src".to_string()),
                ..Default::default()
            },
        );

        assert!(matches!(result, Err(CodebaseIndexError::UnsafeRoot(_))));
    }

    #[test]
    fn repeated_builds_are_deterministic_and_changed_files_change_fingerprint() {
        let temp = tempfile::tempdir().expect("tempdir");
        write_file(temp.path(), "src/lib.rs", b"pub fn one() -> u8 { 1 }\n");

        let first = build_workspace_file_inventory(temp.path(), Default::default()).expect("first");
        let second =
            build_workspace_file_inventory(temp.path(), Default::default()).expect("second");
        assert_eq!(first.snapshot_fingerprint, second.snapshot_fingerprint);

        write_file(temp.path(), "src/lib.rs", b"pub fn two() -> u8 { 2 }\n");
        let changed =
            build_workspace_file_inventory(temp.path(), Default::default()).expect("changed");
        assert_ne!(first.snapshot_fingerprint, changed.snapshot_fingerprint);
    }

    #[test]
    fn truncates_when_file_limit_is_reached() {
        let temp = tempfile::tempdir().expect("tempdir");
        write_file(temp.path(), "a.txt", b"a");
        write_file(temp.path(), "b.txt", b"b");

        let snapshot = build_workspace_file_inventory(
            temp.path(),
            CodebaseIndexBuildOptions {
                max_files: Some(1),
                ..Default::default()
            },
        )
        .expect("snapshot");

        assert_eq!(snapshot.entries.len(), 1);
        assert!(snapshot.truncated);
        assert_eq!(snapshot.counts.truncated_entries, 1);
    }

    #[test]
    fn truncates_directory_and_total_visited_entries_with_bounded_evidence() {
        let temp = tempfile::tempdir().expect("tempdir");
        write_file(temp.path(), "a.txt", b"a");
        write_file(temp.path(), "b.txt", b"b");
        write_file(temp.path(), "c.txt", b"c");

        let directory_truncated = build_workspace_file_inventory(
            temp.path(),
            CodebaseIndexBuildOptions {
                max_directory_entries: Some(2),
                ..Default::default()
            },
        )
        .expect("directory truncated snapshot");

        assert_eq!(directory_truncated.entries.len(), 2);
        assert!(directory_truncated.truncated);
        assert_eq!(directory_truncated.counts.truncated_directories, 1);
        assert_eq!(directory_truncated.counts.visited_entries, 2);

        let visited_truncated = build_workspace_file_inventory(
            temp.path(),
            CodebaseIndexBuildOptions {
                max_visited_entries: Some(1),
                max_directory_entries: Some(10),
                ..Default::default()
            },
        )
        .expect("visited truncated snapshot");

        assert!(visited_truncated.truncated);
        assert_eq!(visited_truncated.counts.visited_entries, 1);
        assert!(visited_truncated.entries.len() <= 1);
    }

    #[cfg(unix)]
    #[test]
    fn no_follow_file_handle_rejects_symlinks_and_overflow() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("tempdir");
        write_file(temp.path(), "target.txt", b"secret");
        symlink(
            temp.path().join("target.txt"),
            temp.path().join("linked.txt"),
        )
        .expect("file symlink");

        assert!(matches!(
            read_regular_file_no_follow(&temp.path().join("linked.txt"), 1024),
            Err(FileReadError::Symlink)
        ));
        assert!(matches!(
            read_regular_file_no_follow(&temp.path().join("target.txt"), 3),
            Err(FileReadError::TooLarge)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_files_and_directories_without_following() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("tempdir");
        let outside = tempfile::tempdir().expect("outside");
        write_file(temp.path(), "src/lib.rs", b"pub fn ok() {}\n");
        write_file(outside.path(), "secret.rs", b"pub fn secret() {}\n");
        symlink(
            outside.path().join("secret.rs"),
            temp.path().join("linked.rs"),
        )
        .expect("file symlink");
        symlink(outside.path(), temp.path().join("linked_dir")).expect("dir symlink");

        let snapshot =
            build_workspace_file_inventory(temp.path(), Default::default()).expect("snapshot");

        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].path, "src/lib.rs");
        assert_eq!(snapshot.counts.skipped_symlink, 2);
        assert!(!snapshot
            .entries
            .iter()
            .any(|entry| entry.path == "linked.rs"));
    }
}
