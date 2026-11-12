use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::io::Write;

use brownie_tools::{ToolExecutionStatus, WorkspaceReadExecutor};
use sha2::{Digest, Sha256};

// Monitor only the calling test thread and only the public read operation.
// File construction and unrelated parallel tests cannot affect this bound.
thread_local! {
    static TRACK: Cell<bool> = const { Cell::new(false) };
    static LARGEST: Cell<usize> = const { Cell::new(0) };
}

struct ObservedAllocator;

fn observe(size: usize) {
    if TRACK.try_with(Cell::get).unwrap_or(false) {
        let _ = LARGEST.try_with(|largest| largest.set(largest.get().max(size)));
    }
}

unsafe impl GlobalAlloc for ObservedAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        observe(layout.size());
        System.alloc(layout)
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        observe(layout.size());
        System.alloc_zeroed(layout)
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        observe(size);
        System.realloc(pointer, layout, size)
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        System.dealloc(pointer, layout)
    }
}

#[global_allocator]
static ALLOCATOR: ObservedAllocator = ObservedAllocator;

#[test]
fn a_bounded_public_read_does_not_allocate_the_entire_large_file() {
    let workspace = tempfile::tempdir().unwrap();
    let path = workspace.path().join("large.txt");
    let mut file = std::fs::File::create(&path).unwrap();
    let chunk = [b'x'; 64 * 1024];
    let mut hash = Sha256::new();
    for _ in 0..1024 {
        file.write_all(&chunk).unwrap();
        hash.update(chunk);
    }
    drop(file);

    LARGEST.with(|largest| largest.set(0));
    TRACK.with(|tracking| tracking.set(true));
    let read = WorkspaceReadExecutor::read(workspace.path(), "large.txt", 4096);
    TRACK.with(|tracking| tracking.set(false));
    let largest = LARGEST.with(Cell::get);
    let result = read.unwrap();

    assert_eq!(result.status, ToolExecutionStatus::Completed);
    assert_eq!(result.output["content"], "x".repeat(4096));
    assert_eq!(result.output["bytes_read"], 4096);
    assert_eq!(result.output["bytes_total"], 64 * 1024 * 1024);
    assert_eq!(result.output["truncated"], true);
    assert_eq!(
        result.output["content_sha256"],
        format!("sha256:{:x}", hash.finalize())
    );
    assert!(
        largest <= 256 * 1024,
        "a 4KiB read requested a {largest}-byte allocation"
    );
}

#[test]
fn invalid_utf8_beyond_the_requested_window_still_fails_without_partial_output() {
    let workspace = tempfile::tempdir().unwrap();
    for tail in [&[0xff][..], &[0xe2, 0x82][..], &[0xe2, b'x'][..]] {
        let mut bytes = vec![b'a'; 128 * 1024];
        bytes.extend_from_slice(tail);
        std::fs::write(workspace.path().join("invalid.txt"), bytes).unwrap();
        let result = WorkspaceReadExecutor::read(workspace.path(), "invalid.txt", 3).unwrap();
        assert_eq!(result.status, ToolExecutionStatus::Failed);
        assert!(result.output.get("content").is_none());
        assert!(result.output.get("content_sha256").is_none());
    }
}

#[test]
fn empty_files_and_eof_offsets_keep_the_existing_public_contract() {
    let workspace = tempfile::tempdir().unwrap();
    for text in ["", "é", "plain"] {
        std::fs::write(workspace.path().join("edge.txt"), text).unwrap();
        let result = WorkspaceReadExecutor::read_from_offset(
            workspace.path(),
            "edge.txt",
            text.len(),
            usize::MAX,
        )
        .unwrap();
        assert_eq!(result.status, ToolExecutionStatus::Completed);
        assert_eq!(result.output["content"], "");
        assert_eq!(result.output["offset_bytes"], text.len());
        assert_eq!(result.output["bytes_end"], text.len());
        assert_eq!(result.output["bytes_read"], 0);
        assert_eq!(result.output["bytes_total"], text.len());
        assert_eq!(result.output["truncated"], false);
        let invalid = WorkspaceReadExecutor::read_from_offset(
            workspace.path(),
            "edge.txt",
            text.len() + 1,
            0,
        )
        .unwrap();
        assert_eq!(invalid.status, ToolExecutionStatus::Failed);
        assert!(invalid.output.get("content").is_none());
    }
}

#[test]
fn utf8_windows_across_stream_boundaries_match_complete_text_ranges() {
    let workspace = tempfile::tempdir().unwrap();
    let text = format!("{}é€🦀{}", "a".repeat(65535), "z".repeat(65536));
    std::fs::write(workspace.path().join("unicode.txt"), &text).unwrap();
    let expected_hash = format!("sha256:{:x}", Sha256::digest(text.as_bytes()));
    for offset in 65533..65547 {
        for maximum in 0..13 {
            let mut start = offset;
            while !text.is_char_boundary(start) {
                start += 1;
            }
            let mut end = start.saturating_add(maximum).min(text.len());
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            let result = WorkspaceReadExecutor::read_from_offset(
                workspace.path(),
                "unicode.txt",
                offset,
                maximum,
            )
            .unwrap();
            assert_eq!(
                result.status,
                ToolExecutionStatus::Completed,
                "offset={offset}, maximum={maximum}"
            );
            assert_eq!(result.output["content"], &text[start..end]);
            assert_eq!(result.output["offset_bytes"], start);
            assert_eq!(result.output["bytes_end"], end);
            assert_eq!(result.output["bytes_total"], text.len());
            assert_eq!(result.output["truncated"], end < text.len());
            assert_eq!(result.output["content_sha256"], expected_hash);
        }
    }
}
