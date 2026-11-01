use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const PROVENANCE_DOMAIN: &[u8] = b"brownie-build-provenance-v1\0";

fn main() {
    let workspace_root = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR").expect("Cargo must provide CARGO_MANIFEST_DIR"),
    )
    .ancestors()
    .nth(2)
    .expect("Brownie package must be nested under crates/<package>")
    .to_path_buf();

    let files = tracked_provenance_inputs(&workspace_root);
    let mut digest = Sha256::new();
    digest.update(PROVENANCE_DOMAIN);
    for relative in files {
        // Cargo resolves relative change-tracking paths from the package that
        // owns this build script. This script is shared by two packages, so
        // use the selected workspace's absolute paths instead.
        let input_path = workspace_root.join(&relative);
        println!("cargo:rerun-if-changed={}", input_path.display());
        let bytes = fs::read(&input_path)
            .unwrap_or_else(|error| panic!("failed to read provenance input {relative}: {error}"));
        digest.update(relative.as_bytes());
        digest.update([0]);
        digest.update(bytes);
        digest.update([0]);
    }
    println!(
        "cargo:rerun-if-changed={}",
        workspace_root.join("build-provenance.rs").display()
    );
    println!(
        "cargo:rustc-env=BROWNIE_BUILD_SOURCE_FINGERPRINT=sha256:{:x}",
        digest.finalize()
    );
}

fn tracked_provenance_inputs(workspace_root: &Path) -> Vec<String> {
    let output = Command::new("git")
        .args(["ls-files", "-z"])
        .current_dir(workspace_root)
        .output()
        .expect("git is required to build Brownie from its deployment source");
    assert!(
        output.status.success(),
        "git ls-files failed while deriving Brownie build provenance"
    );

    let mut files: Vec<String> = output
        .stdout
        .split(|byte| *byte == 0)
        .filter_map(|entry| std::str::from_utf8(entry).ok())
        .filter(|relative| is_provenance_input(relative))
        .map(str::to_owned)
        .collect();
    files.sort();
    assert!(
        !files.is_empty(),
        "Brownie build provenance requires tracked Rust workspace inputs"
    );
    files
}

fn is_provenance_input(relative: &str) -> bool {
    matches!(
        relative,
        "Cargo.lock" | "Cargo.toml" | "build-provenance.rs"
    ) || (relative.starts_with("crates/")
        && (relative.ends_with(".rs") || relative.ends_with("/Cargo.toml")))
}
