//! Clone-first worktree add (APFS): populate a new worktree with `clonefile(2)`
//! clones of this checkout's tracked files instead of letting git write every
//! blob to disk. A clone shares the source's extents until either copy is
//! written, so N parallel task worktrees cost one checkout of physical space
//! plus each task's own edits (the mechanism `omp worktree` uses — verified
//! empirically: 5 × 1GB logical worktrees ≈ 268KB of real blocks).
//!
//! The clone path is an OPTIMIZATION only. It runs `git worktree add
//! --no-checkout`, mirrors the source's tracked files, carries the source's
//! index over so `update-index --refresh` can re-cache stat data (new inodes)
//! instead of rewriting every entry from the object store, then lets
//! `git reset --hard` rewrite the few files whose content differs from the
//! branch tip. Anything that cannot be guaranteed — different volume, sparse
//! index, an unexpected dirty checkout afterwards — tears the half-built
//! worktree down and reports `false` so the caller's plain `git worktree add`
//! produces the authoritative result. Callers only see the worktree contract:
//! a fresh checkout attached to the new branch, contents matching its tip.

use std::io;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use super::git::run_git;
use crate::app_error::AppCommandError;

/// Entry parsed from `git ls-tree -r -z`: an octal mode and its repo-relative
/// path. Gitlink entries (submodules, mode 160000) are dropped — the plain
/// checkout leaves them empty too.
struct TreeEntry {
    mode: u32,
    path: String,
}

/// Attempts the clone-first add. Returns `Ok(true)` when the worktree was
/// created and populated via clones, `Ok(false)` when the caller must fall
/// back to a plain `git worktree add` (which then reports any real error).
pub async fn try_add_cloned(
    repo_path: &str,
    branch_name: &str,
    worktree_path: &str,
    base: Option<&str>,
) -> Result<bool, AppCommandError> {
    if !paths_share_volume(Path::new(repo_path), Path::new(worktree_path)) {
        return Ok(false);
    }
    // A copied source index only describes the tree when it is one plain file.
    for key in ["core.sparsecheckout", "core.splitindex"] {
        let probe = run_git(repo_path, &["config", "--get", key]).await?;
        if probe.status.success() && !probe.stdout.is_empty() {
            return Ok(false);
        }
    }

    let mut args = vec![
        "worktree",
        "add",
        "--no-checkout",
        "-b",
        branch_name,
        worktree_path,
    ];
    if let Some(commitish) = base {
        args.push(commitish);
    }
    let out = run_git(repo_path, &args).await?;
    if !out.status.success() {
        // The plain add re-runs the same command and surfaces git's error.
        return Ok(false);
    }

    match populate_cloned(repo_path, worktree_path).await {
        Ok((cloned, copied)) => {
            tracing::info!(
                "[worktree_clone] {worktree_path} populated via APFS clonefile \
                 ({cloned} cloned, {copied} copied)"
            );
            Ok(true)
        }
        Err(reason) => {
            tracing::warn!("[worktree_clone] clone-first fell back to plain add: {reason}");
            cleanup_failed_add(repo_path, branch_name, worktree_path).await;
            Ok(false)
        }
    }
}

/// Populates the registered-but-empty checkout and reconciles it to the
/// branch tip. Any failure leaves a recoverable state for the cleanup caller.
/// Returns `(cloned, copied)` — how many files went through `clonefile(2)`
/// versus the per-file copy fallback.
async fn populate_cloned(repo_path: &str, worktree_path: &str) -> Result<(usize, usize), String> {
    // Tracked entries at the worktree's HEAD, NUL-delimited so odd filenames
    // survive verbatim. HEAD already points at the new branch.
    let listing = run_git(worktree_path, &["ls-tree", "-r", "-z", "--full-tree", "HEAD"])
        .await
        .map_err(|e| e.to_string())?;
    if !listing.status.success() {
        return Err(format!("ls-tree failed: {}", stderr_of(&listing)));
    }
    let entries = parse_ls_tree(&listing.stdout);

    let repo = PathBuf::from(repo_path);
    let worktree = PathBuf::from(worktree_path);
    let (cloned, copied) = tokio::task::spawn_blocking(move || clone_files(&repo, &worktree, &entries))
        .await
        .map_err(|e| e.to_string())??;

    // The source's index carries each entry's content hash; only its stat
    // cache is stale (the clones are new inodes). Carrying it over lets
    // `update-index --refresh` re-cache stat data instead of making
    // `reset --hard` rewrite every file from the object store.
    let source_index = git_dir_of(repo_path).join("index");
    let target_index = git_dir_of(worktree_path).join("index");
    std::fs::copy(&source_index, &target_index).map_err(|e| format!("index copy failed: {e}"))?;

    // Best-effort: a non-zero exit just means some cloned file differs from
    // the index (dirty source) — `reset --hard` rewrites exactly those.
    let _ = run_git(worktree_path, &["update-index", "--refresh"]).await;

    let reset = run_git(worktree_path, &["reset", "--hard"])
        .await
        .map_err(|e| e.to_string())?;
    if !reset.status.success() {
        return Err(format!("reset --hard failed: {}", stderr_of(&reset)));
    }

    // Safety net for every subtlety the index trick could miss (skip-worktree
    // entries, a mid-copy index write, …): a wrong checkout must never ship
    // as a "successful" clone — bail out to the plain add instead.
    let status = run_git(worktree_path, &["status", "--porcelain"])
        .await
        .map_err(|e| e.to_string())?;
    if !status.status.success() {
        return Err(format!("status failed: {}", stderr_of(&status)));
    }
    if !status.stdout.is_empty() {
        return Err(format!(
            "clone left a dirty checkout: {}",
            String::from_utf8_lossy(&status.stdout)
        ));
    }
    Ok((cloned, copied))
}

/// Mirrors the source checkout's tracked files into the worktree. Regular
/// files go through `clonefile(2)`; a per-file failure degrades that one file
/// to a plain copy. Files deleted in the source are skipped — `reset --hard`
/// restores them from the object store.
fn clone_files(repo: &Path, worktree: &Path, entries: &[TreeEntry]) -> Result<(usize, usize), String> {
    let mut cloned = 0usize;
    let mut copied = 0usize;
    for entry in entries {
        let destination = worktree.join(&entry.path);
        if entry.mode == 0o120000 {
            // A symlink the source deleted is restored by `reset --hard`.
            let Ok(target) = std::fs::read_link(repo.join(&entry.path)) else {
                continue;
            };
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::os::unix::fs::symlink(target, &destination)
                .map_err(|e| format!("symlink {}: {e}", entry.path))?;
            continue;
        }
        let source = repo.join(&entry.path);
        if !source.is_file() {
            continue;
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        if clone_file(&source, &destination).is_ok() {
            cloned += 1;
        } else {
            std::fs::copy(&source, &destination)
                .map_err(|e| format!("copy {}: {e}", entry.path))?;
            copied += 1;
        }
    }
    Ok((cloned, copied))
}

/// `clonefile(2)`: makes `dst` share `src`'s extents until either side is
/// written. Both paths must live on one APFS volume — the caller probes
/// `st_dev` first, and a per-file failure falls back to a plain copy.
fn clone_file(source: &Path, destination: &Path) -> io::Result<()> {
    let src = std::ffi::CString::new(source.as_os_str().as_bytes())?;
    let dst = std::ffi::CString::new(destination.as_os_str().as_bytes())?;
    let rc = unsafe { libc::clonefile(src.as_ptr(), dst.as_ptr(), 0) };
    if rc == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

/// True when both trees resolve to the same filesystem device, the precondition
/// for extent sharing. Uncreated leading directories walk up to the nearest
/// existing ancestor — the engine creates worktree roots lazily.
fn paths_share_volume(repo: &Path, worktree: &Path) -> bool {
    let (Some(repo_dev), Some(worktree_dev)) = (
        existing_dev(repo),
        existing_dev(worktree.parent().unwrap_or(worktree)),
    ) else {
        return false;
    };
    repo_dev == worktree_dev
}

fn existing_dev(path: &Path) -> Option<u64> {
    let mut current = path;
    loop {
        match current.metadata() {
            Ok(meta) => return Some(meta.dev()),
            Err(_) => current = current.parent()?,
        }
    }
}

fn git_dir_of(path: &str) -> PathBuf {
    // `--absolute-git-dir` is stable across git versions that already ship
    // `worktree add --no-checkout`, and resolves the per-worktree admin dir
    // for linked worktrees too.
    let output = std::process::Command::new("git")
        .args(["rev-parse", "--absolute-git-dir"])
        .current_dir(path)
        .output();
    match output {
        Ok(out) if out.status.success() => {
            PathBuf::from(String::from_utf8_lossy(&out.stdout).trim())
        }
        _ => PathBuf::from(path).join(".git"),
    }
}

fn parse_ls_tree(raw: &[u8]) -> Vec<TreeEntry> {
    raw.split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .filter_map(|entry| {
            let tab = entry.iter().position(|byte| *byte == b'\t')?;
            let (meta, path) = entry.split_at(tab);
            let path = String::from_utf8_lossy(&path[1..]).into_owned();
            let mode_str = std::str::from_utf8(&meta[..6]).ok()?;
            let mode = u32::from_str_radix(mode_str, 8).ok()?;
            (mode != 0o160000).then(|| TreeEntry { mode, path })
        })
        .collect()
}

fn stderr_of(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stderr).trim().to_string()
}

async fn cleanup_failed_add(repo_path: &str, branch_name: &str, worktree_path: &str) {
    let _ = run_git(repo_path, &["worktree", "remove", "--force", worktree_path]).await;
    let _ = std::fs::remove_dir_all(worktree_path);
    // The successful `worktree add -b` created the branch; leaving it behind
    // would make the plain re-add fail with "branch already exists" instead
    // of surfacing the real checkout problem.
    let _ = run_git(repo_path, &["branch", "-D", branch_name]).await;
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    async fn git(cwd: &Path, args: &[&str]) {
        let out = run_git(cwd.to_str().expect("utf-8"), args).await.expect("git runs");
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            stderr_of(&out)
        );
    }

    /// The clone path must land the same result the plain add promises: a
    /// checkout attached to the new branch whose contents match the branch
    /// tip — not the source's dirty working copy — with the source untouched.
    #[tokio::test]
    async fn clone_first_add_matches_the_branch_tip_not_the_dirty_source() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = dir.path().join("repo");
        std::fs::create_dir(&repo).expect("mkdir");
        git(&repo, &["init", "-q", "-b", "main"]).await;
        std::fs::create_dir_all(repo.join("nested")).expect("mkdir");
        std::fs::write(repo.join("base.txt"), "base\n").expect("write");
        std::fs::write(repo.join("nested/dir.txt"), "dir\n").expect("write");
        let script = repo.join("exec.sh");
        std::fs::write(&script, "#!/bin/sh\n").expect("write");
        #[cfg(unix)]
        std::fs::set_permissions(&script, std::os::unix::fs::PermissionsExt::from_mode(0o755))
            .expect("chmod");
        git(&repo, &["add", "-A"]).await;
        git(
            &repo,
            &[
                "-c",
                "user.email=t@t",
                "-c",
                "user.name=t",
                "commit",
                "-qm",
                "base",
            ],
        )
        .await;

        git(&repo, &["checkout", "-q", "-b", "feature"]).await;
        std::fs::write(repo.join("base.txt"), "feature\n").expect("write");
        std::fs::write(repo.join("feat.txt"), "feat\n").expect("write");
        git(&repo, &["add", "-A"]).await;
        git(
            &repo,
            &[
                "-c",
                "user.email=t@t",
                "-c",
                "user.name=t",
                "commit",
                "-qm",
                "feature",
            ],
        )
        .await;
        git(&repo, &["checkout", "-q", "main"]).await;

        // The source checkout is dirty (uncommitted edit + untracked file) —
        // exactly the state the clone must NOT leak into the new worktree.
        std::fs::write(repo.join("base.txt"), "dirty\n").expect("write");
        std::fs::write(repo.join("junk.txt"), "untracked\n").expect("write");

        let worktree = dir.path().join("trees").join("nested").join("repo-task-1");
        let worktree_path = worktree.to_str().expect("utf-8");
        let added = try_add_cloned(
            repo.to_str().expect("utf-8"),
            "task-1",
            worktree_path,
            Some("feature"),
        )
        .await
        .expect("clone-first add probes cleanly");
        assert!(added, "APFS clonefile is available on this machine");

        let head = run_git(worktree_path, &["symbolic-ref", "--quiet", "HEAD"])
            .await
            .expect("head probe");
        assert_eq!(
            String::from_utf8_lossy(&head.stdout).trim(),
            "refs/heads/task-1",
            "the checkout is attached to the new branch"
        );
        assert_eq!(
            std::fs::read_to_string(worktree.join("base.txt")).expect("read"),
            "feature\n",
            "content matches the branch tip, not the source's dirty copy"
        );
        assert_eq!(
            std::fs::read_to_string(worktree.join("feat.txt")).expect("read"),
            "feat\n"
        );
        assert_eq!(
            std::fs::read_to_string(worktree.join("nested/dir.txt")).expect("read"),
            "dir\n"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(worktree.join("exec.sh"))
                .expect("stat")
                .permissions()
                .mode();
            assert_ne!(mode & 0o111, 0, "the executable bit survives the clone");
        }
        assert!(
            !worktree.join("junk.txt").exists(),
            "untracked source files are not cloned"
        );
        assert_eq!(
            std::fs::read_to_string(repo.join("base.txt")).expect("read"),
            "dirty\n",
            "the source's dirty state is untouched"
        );

        let status = run_git(worktree_path, &["status", "--porcelain"])
            .await
            .expect("status");
        assert!(status.stdout.is_empty(), "the checkout is clean");
    }
}
