//! Codebase indexing crate.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, VecDeque};
use std::ffi::{OsStr, OsString};
use std::fs::{self, File, OpenOptions};
use std::io::{Error, ErrorKind, Read};
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
    #[error("unsupported platform: {0}")]
    UnsupportedPlatform(String),
}

pub fn build_workspace_file_inventory(
    workspace_root: impl AsRef<Path>,
    options: CodebaseIndexBuildOptions,
) -> Result<CodebaseIndexSnapshot, CodebaseIndexError> {
    let workspace_root = workspace_root.as_ref();
    let limits = limits_from_options(&options);
    let root = resolve_safe_root(options.root.as_deref(), &limits)?;
    if !platform_supports_no_follow_reads() {
        return Err(CodebaseIndexError::UnsupportedPlatform(
            "safe no-follow file reads are unavailable for codebase indexing".to_string(),
        ));
    }
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

        let directory_handle = match open_validated_directory(&canonical_workspace_root, &directory)
        {
            Ok(directory_handle) => directory_handle,
            Err(QueuedDirectoryError::Unreadable) => {
                counts.skipped_unreadable += 1;
                continue;
            }
            Err(QueuedDirectoryError::Symlink) => {
                counts.skipped_symlink += 1;
                continue;
            }
            Err(QueuedDirectoryError::NotDirectory) => {
                counts.skipped_other += 1;
                continue;
            }
            Err(QueuedDirectoryError::UnsafePath) => {
                counts.skipped_unsafe_path += 1;
                continue;
            }
        };

        let (children, directory_truncated) =
            match sorted_directory_entries(&directory_handle, limits.max_directory_entries) {
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

            let name = child;
            let child_path = directory.join(&name);
            let child_relative = relative_directory.join(&name);
            let Some(relative_path) = workspace_relative_path(&child_relative) else {
                counts.skipped_unsafe_path += 1;
                continue;
            };

            if relative_path.chars().count() > limits.max_path_chars {
                counts.skipped_unsafe_path += 1;
                continue;
            }

            let child_kind = match child_kind_no_follow(&directory_handle, &name) {
                Ok(kind) => kind,
                Err(_) => {
                    counts.skipped_unreadable += 1;
                    continue;
                }
            };

            if child_kind == DirectoryChildKind::Symlink {
                counts.skipped_symlink += 1;
                continue;
            }

            if child_kind == DirectoryChildKind::Directory {
                if is_protected_or_generated_component(&name) {
                    counts.skipped_protected += 1;
                    continue;
                }
                queue.push_back((child_path, child_relative));
                continue;
            }

            if child_kind != DirectoryChildKind::RegularFile {
                counts.skipped_other += 1;
                continue;
            }

            if entries.len() >= limits.max_files {
                truncated = true;
                counts.truncated_entries += 1;
                continue;
            }

            let file_read =
                match read_regular_child_no_follow(&directory_handle, &name, limits.max_file_bytes)
                {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum QueuedDirectoryError {
    Unreadable,
    Symlink,
    NotDirectory,
    UnsafePath,
}

#[cfg(unix)]
struct ValidatedDirectory {
    file: File,
}

#[cfg(not(unix))]
struct ValidatedDirectory;

#[cfg(unix)]
fn open_validated_directory(
    canonical_workspace_root: &Path,
    directory: &Path,
) -> Result<ValidatedDirectory, QueuedDirectoryError> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

    let metadata = fs::symlink_metadata(directory).map_err(|_| QueuedDirectoryError::Unreadable)?;
    if metadata.file_type().is_symlink() {
        return Err(QueuedDirectoryError::Symlink);
    }
    if !metadata.is_dir() {
        return Err(QueuedDirectoryError::NotDirectory);
    }
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(directory)
        .map_err(directory_open_error)?;
    let handle_metadata = file
        .metadata()
        .map_err(|_| QueuedDirectoryError::Unreadable)?;
    if !handle_metadata.is_dir() {
        return Err(QueuedDirectoryError::NotDirectory);
    }
    let canonical_directory = directory
        .canonicalize()
        .map_err(|_| QueuedDirectoryError::Unreadable)?;
    if !canonical_directory.starts_with(canonical_workspace_root) {
        return Err(QueuedDirectoryError::UnsafePath);
    }
    let canonical_metadata =
        fs::symlink_metadata(&canonical_directory).map_err(|_| QueuedDirectoryError::Unreadable)?;
    if canonical_metadata.dev() != handle_metadata.dev()
        || canonical_metadata.ino() != handle_metadata.ino()
    {
        return Err(QueuedDirectoryError::UnsafePath);
    }
    Ok(ValidatedDirectory { file })
}

#[cfg(not(unix))]
fn open_validated_directory(
    _canonical_workspace_root: &Path,
    _directory: &Path,
) -> Result<ValidatedDirectory, QueuedDirectoryError> {
    Err(QueuedDirectoryError::Unreadable)
}

#[cfg(unix)]
fn directory_open_error(error: std::io::Error) -> QueuedDirectoryError {
    match error.raw_os_error() {
        Some(code) if code == libc::ELOOP => QueuedDirectoryError::Symlink,
        Some(code) if code == libc::ENOTDIR => QueuedDirectoryError::NotDirectory,
        _ => QueuedDirectoryError::Unreadable,
    }
}

fn sorted_directory_entries(
    directory: &ValidatedDirectory,
    max_directory_entries: usize,
) -> std::io::Result<(Vec<OsString>, bool)> {
    let mut entries = BinaryHeap::new();
    let mut truncated = false;
    for name in read_directory_entry_names(directory)? {
        let candidate = DirectoryEntryCandidate { name };
        if entries.len() < max_directory_entries {
            entries.push(candidate);
            continue;
        }

        truncated = true;
        let should_keep = entries
            .peek()
            .is_some_and(|largest| compare_os_names(&candidate.name, &largest.name).is_lt());
        if should_keep {
            entries.pop();
            entries.push(candidate);
        }
    }
    let mut entries = entries
        .into_iter()
        .map(|candidate| candidate.name)
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| compare_os_names(a, b));
    Ok((entries, truncated))
}

struct DirectoryEntryCandidate {
    name: OsString,
}

impl PartialEq for DirectoryEntryCandidate {
    fn eq(&self, other: &Self) -> bool {
        compare_os_names(&self.name, &other.name).is_eq()
    }
}

impl Eq for DirectoryEntryCandidate {}

impl PartialOrd for DirectoryEntryCandidate {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for DirectoryEntryCandidate {
    fn cmp(&self, other: &Self) -> Ordering {
        compare_os_names(&self.name, &other.name)
    }
}

#[cfg(unix)]
fn read_directory_entry_names(directory: &ValidatedDirectory) -> std::io::Result<Vec<OsString>> {
    use std::ffi::CStr;
    use std::os::fd::AsRawFd;
    use std::os::unix::ffi::OsStringExt;

    let dup_fd = unsafe { libc::dup(directory.file.as_raw_fd()) };
    if dup_fd < 0 {
        return Err(Error::last_os_error());
    }
    let dir = unsafe { libc::fdopendir(dup_fd) };
    if dir.is_null() {
        let error = Error::last_os_error();
        unsafe {
            libc::close(dup_fd);
        }
        return Err(error);
    }

    struct DirectoryStream(*mut libc::DIR);
    impl Drop for DirectoryStream {
        fn drop(&mut self) {
            unsafe {
                libc::closedir(self.0);
            }
        }
    }

    let _stream = DirectoryStream(dir);
    let mut names = Vec::new();
    loop {
        let entry = unsafe { libc::readdir(dir) };
        if entry.is_null() {
            break;
        }
        let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
        let bytes = name.to_bytes();
        if bytes == b"." || bytes == b".." {
            continue;
        }
        names.push(OsString::from_vec(bytes.to_vec()));
    }
    Ok(names)
}

#[cfg(not(unix))]
fn read_directory_entry_names(_directory: &ValidatedDirectory) -> std::io::Result<Vec<OsString>> {
    Err(Error::new(
        ErrorKind::Unsupported,
        "directory descriptor reads are unsupported on this platform",
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DirectoryChildKind {
    Symlink,
    Directory,
    RegularFile,
    Other,
}

#[cfg(unix)]
fn child_kind_no_follow(
    directory: &ValidatedDirectory,
    name: &OsStr,
) -> std::io::Result<DirectoryChildKind> {
    use std::mem::MaybeUninit;
    use std::os::fd::AsRawFd;

    let name = c_name_from_os_str(name)?;
    let mut stat = MaybeUninit::<libc::stat>::uninit();
    let result = unsafe {
        libc::fstatat(
            directory.file.as_raw_fd(),
            name.as_ptr(),
            stat.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    if result != 0 {
        return Err(Error::last_os_error());
    }
    let mode = unsafe { stat.assume_init().st_mode };
    Ok(match mode & libc::S_IFMT {
        libc::S_IFLNK => DirectoryChildKind::Symlink,
        libc::S_IFDIR => DirectoryChildKind::Directory,
        libc::S_IFREG => DirectoryChildKind::RegularFile,
        _ => DirectoryChildKind::Other,
    })
}

#[cfg(not(unix))]
fn child_kind_no_follow(
    _directory: &ValidatedDirectory,
    _name: &OsStr,
) -> std::io::Result<DirectoryChildKind> {
    Err(Error::new(
        ErrorKind::Unsupported,
        "no-follow child metadata is unsupported on this platform",
    ))
}

fn platform_supports_no_follow_reads() -> bool {
    cfg!(unix)
}

#[cfg(test)]
fn sorted_directory_names(
    directory: &Path,
    max_directory_entries: usize,
) -> std::io::Result<(Vec<String>, bool)> {
    let canonical_workspace_root = directory.canonicalize()?;
    let directory = open_validated_directory(&canonical_workspace_root, directory)
        .map_err(|error| Error::other(format!("directory validation failed: {error:?}")))?;
    let (entries, truncated) = sorted_directory_entries(&directory, max_directory_entries)?;
    Ok((
        entries
            .into_iter()
            .map(|name| name.to_string_lossy().to_string())
            .collect(),
        truncated,
    ))
}

#[cfg(test)]
fn directory_revalidation_result(
    canonical_workspace_root: &Path,
    directory: &Path,
) -> Result<(), QueuedDirectoryError> {
    open_validated_directory(canonical_workspace_root, directory).map(|_| ())
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
fn read_regular_child_no_follow(
    directory: &ValidatedDirectory,
    name: &OsStr,
    max_file_bytes: u64,
) -> Result<FileRead, FileReadError> {
    use std::os::fd::{AsRawFd, FromRawFd};

    let name = c_name_from_os_str(name).map_err(|_| FileReadError::Unreadable)?;
    let fd = unsafe {
        libc::openat(
            directory.file.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW,
        )
    };
    if fd < 0 {
        return Err(match Error::last_os_error().raw_os_error() {
            Some(code) if code == libc::ELOOP => FileReadError::Symlink,
            _ => FileReadError::Unreadable,
        });
    }
    let file = unsafe { File::from_raw_fd(fd) };
    read_bounded_regular_handle(file, max_file_bytes)
}

#[cfg(not(unix))]
fn read_regular_child_no_follow(
    _directory: &ValidatedDirectory,
    _name: &OsStr,
    _max_file_bytes: u64,
) -> Result<FileRead, FileReadError> {
    Err(FileReadError::UnsupportedNoFollow)
}

#[cfg(all(test, unix))]
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
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        return a.as_bytes().cmp(b.as_bytes());
    }
    #[cfg(not(unix))]
    {
        return a.to_string_lossy().cmp(&b.to_string_lossy());
    }
}

#[cfg(unix)]
fn c_name_from_os_str(name: &OsStr) -> std::io::Result<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;

    std::ffi::CString::new(name.as_bytes()).map_err(|_| {
        Error::new(
            ErrorKind::InvalidInput,
            "directory entry name contains an interior NUL",
        )
    })
}

#[cfg(not(unix))]
fn c_name_from_os_str(_name: &OsStr) -> std::io::Result<std::ffi::CString> {
    Err(Error::new(
        ErrorKind::Unsupported,
        "C string conversion is unsupported on this platform",
    ))
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

    #[cfg(unix)]
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

    #[cfg(unix)]
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

    #[cfg(unix)]
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

    #[cfg(unix)]
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

    #[cfg(unix)]
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

    #[cfg(unix)]
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

    #[test]
    fn directory_limit_selects_lexicographically_smallest_entries() {
        let temp = tempfile::tempdir().expect("tempdir");
        write_file(temp.path(), "z.txt", b"z");
        write_file(temp.path(), "m.txt", b"m");
        write_file(temp.path(), "a.txt", b"a");
        write_file(temp.path(), "b.txt", b"b");

        let (names, truncated) = sorted_directory_names(temp.path(), 2).expect("directory names");

        assert!(truncated);
        assert_eq!(names, vec!["a.txt", "b.txt"]);
    }

    #[cfg(unix)]
    #[test]
    fn bounded_directory_order_uses_original_unix_bytes_for_lossy_equivalent_names() {
        use std::os::unix::ffi::OsStringExt;

        let low = OsString::from_vec(vec![b'n', b'a', 0x80]);
        let high = OsString::from_vec(vec![b'n', b'a', 0x81]);
        assert_eq!(low.to_string_lossy(), high.to_string_lossy());

        let mut entries = BinaryHeap::new();
        entries.push(DirectoryEntryCandidate { name: high });
        let candidate = DirectoryEntryCandidate { name: low.clone() };
        if entries
            .peek()
            .is_some_and(|largest| compare_os_names(&candidate.name, &largest.name).is_lt())
        {
            entries.pop();
            entries.push(candidate);
        }

        let selected = entries.pop().expect("selected").name;
        assert_eq!(selected.into_vec(), low.into_vec());
    }

    #[cfg(unix)]
    #[test]
    fn queued_directory_revalidation_rejects_symlink_replacements() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("tempdir");
        let outside = tempfile::tempdir().expect("outside");
        let queued = temp.path().join("queued");
        fs::create_dir(&queued).expect("queued dir");
        fs::remove_dir(&queued).expect("remove queued dir");
        symlink(outside.path(), &queued).expect("replace queued dir with symlink");
        let canonical_workspace_root = temp.path().canonicalize().expect("canonical root");

        assert_eq!(
            directory_revalidation_result(&canonical_workspace_root, &queued),
            Err(QueuedDirectoryError::Symlink)
        );
    }

    #[cfg(unix)]
    #[test]
    fn queued_directory_revalidation_rejects_parent_symlink_escape() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("tempdir");
        let outside = tempfile::tempdir().expect("outside");
        fs::create_dir(temp.path().join("parent")).expect("parent");
        fs::create_dir(temp.path().join("parent/child")).expect("child");
        fs::create_dir(outside.path().join("child")).expect("outside child");
        let queued = temp.path().join("parent/child");
        fs::remove_dir(temp.path().join("parent/child")).expect("remove child");
        fs::remove_dir(temp.path().join("parent")).expect("remove parent");
        symlink(outside.path(), temp.path().join("parent")).expect("replace parent");
        let canonical_workspace_root = temp.path().canonicalize().expect("canonical root");

        assert_eq!(
            directory_revalidation_result(&canonical_workspace_root, &queued),
            Err(QueuedDirectoryError::UnsafePath)
        );
    }

    #[cfg(not(unix))]
    #[test]
    fn unsupported_platform_fails_closed_before_snapshot() {
        let temp = tempfile::tempdir().expect("tempdir");
        write_file(temp.path(), "src/lib.rs", b"pub fn ok() {}\n");

        let result = build_workspace_file_inventory(temp.path(), Default::default());

        assert!(matches!(
            result,
            Err(CodebaseIndexError::UnsupportedPlatform(_))
        ));
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
