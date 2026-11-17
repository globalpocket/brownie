//! A persistent inode keeps kernel ownership stable across process exit.
//!
//! Publish an initialized, already-locked inode atomically. Never unlink the
//! canonical path: unlinking a locked inode would permit a second independent
//! owner. Unknown legacy lock contents remain busy; age is not ownership proof.
use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use fs2::FileExt;
use uuid::Uuid;

const MARKER: &[u8] = b"brownie-run-admission-kernel-lease-v1\n";

struct Pending(PathBuf);
impl Drop for Pending {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub(super) fn acquire(run_dir: &Path) -> Result<File> {
    fs::create_dir_all(run_dir)
        .with_context(|| format!("failed to create {}", run_dir.display()))?;
    let lock = run_dir.join("parent-join-admission.lock");
    for _ in 0..super::RUN_ADMISSION_LOCK_RETRIES {
        match OpenOptions::new().read(true).write(true).open(&lock) {
            Ok(mut file) => {
                if !fs::symlink_metadata(&lock)?.file_type().is_file() {
                    bail!("run admission lock must be an ordinary file");
                }
                match file.try_lock_exclusive() {
                    Ok(()) => {
                        let mut marker = Vec::new();
                        (&mut file)
                            .take(MARKER.len() as u64 + 1)
                            .read_to_end(&mut marker)?;
                        if marker == MARKER {
                            return Ok(file);
                        }
                        // An older process does not use this kernel lock. Do
                        // not treat our acquired OS lock as authority to remove
                        // or reuse its timestamp-only lock file.
                    }
                    Err(error)
                        if error.kind() == ErrorKind::WouldBlock
                            || error.raw_os_error()
                                == fs2::lock_contended_error().raw_os_error() => {}
                    Err(error) => return Err(error).context("failed to lock run admission lease"),
                }
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                let pending =
                    Pending(run_dir.join(format!(".admission-{}.pending", Uuid::new_v4())));
                let mut file = OpenOptions::new()
                    .read(true)
                    .write(true)
                    .create_new(true)
                    .open(&pending.0)?;
                file.write_all(MARKER)?;
                file.sync_all()?;
                file.try_lock_exclusive()
                    .context("failed to lock unpublished run admission lease")?;
                match fs::hard_link(&pending.0, &lock) {
                    Ok(()) => {
                        super::sync_dir(run_dir)?;
                        return Ok(file);
                    }
                    Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
                    Err(error) => {
                        return Err(error).context("failed to publish run admission lease")
                    }
                }
            }
            Err(error) => {
                return Err(error).with_context(|| format!("failed to open {}", lock.display()))
            }
        }
        std::thread::sleep(super::RUN_ADMISSION_LOCK_SLEEP);
    }
    bail!(
        "run admission lock remained busy after {} attempts: {}",
        super::RUN_ADMISSION_LOCK_RETRIES,
        lock.display()
    )
}
