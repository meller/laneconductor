// conductor/services/claude-dir-copy.mjs
//
// Track AM-10096 (found live): createWorktree() used to copy the repo's
// .claude directory into a new worktree with a plain shell command:
//
//   execSync(`cp -r "${claudeSrc}" "${claudeDest}"`)
//
// `cp -r SRC DEST` copies SRC's *contents* into DEST only when DEST does not
// already exist. When DEST already exists as a directory, cp copies SRC
// *itself* into it, producing DEST/.claude. This repository tracks files
// under .claude/ (.claude/MEMORY.md, .claude/settings.json,
// .claude/skills/laneconductor/SKILL.md — deliberately, since this repo is
// the skill's own canonical home), so `git worktree add` always checks out
// a `.claude` directory before this copy ever runs. The destination always
// existed, so this hit the trap on every single worktree creation — one
// extra nesting level landed on `main` per track lifecycle, reaching 5
// levels deep / 480 tracked files / 6.4MB before this fix (root cause
// write-up: this track's spec.md).
//
// DO NOT reintroduce `cp -r` (or any shell `cp`) at the call site. Use
// `fs.cpSync` instead, which correctly merges into an existing destination
// directory rather than nesting into it — verified directly: three
// consecutive `cpSync(src, dest, {recursive:true})` calls into an
// already-existing `dest` leave depth at 1, where a single `cp -r` produces
// `dest/.claude`. `cpSync` also has no shell quoting hazard for paths
// containing spaces.
//
// Extracted here (rather than left inline in laneconductor.sync.mjs) for
// the same reason as services/worktree-start-point.mjs and
// services/worktree-create-args.mjs: that file has no exports and runs
// setIntervals/chokidar watchers at import, so nothing in it is
// unit-testable in isolation.
//
//   shouldCopyClaudeEntry(relPath) — the pure predicate: should this one
//                                    path (relative to the source .claude
//                                    root) be copied into the worktree?
//   copyClaudeDir(repoRoot, worktreePath) — the actual copy, filtered by
//                                    the predicate above.

import { existsSync, cpSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';

// Anchored at the .claude root — a same-named file nested deeper (e.g.
// skills/my-settings.local.json) is NOT excluded by this list. Only an
// entry whose first path segment matches is machine-local state.
const ROOT_EXCLUSIONS = new Set(['settings.local.json', 'scheduled_tasks.lock', 'worktrees']);

/**
 * @param {string} relPath - path relative to the source .claude directory,
 *   using '/' as separator (as produced by fs.cpSync's filter callback,
 *   which always passes POSIX-style paths regardless of platform... in
 *   practice cpSync passes platform-native paths, so this also accepts the
 *   platform separator).
 * @returns {boolean} whether this entry should be copied into a worktree's .claude
 */
export function shouldCopyClaudeEntry(relPath) {
  if (!relPath) return true; // the .claude root itself
  const parts = relPath.split(/[\\/]/).filter(Boolean);
  const firstSegment = parts[0];

  // REQ-3: never propagate an already-nested .claude — this is what makes
  // the fix self-healing even when the SOURCE is already corrupted.
  if (firstSegment === '.claude') return false;

  // REQ-4: machine-local state, anchored at the .claude root only.
  if (parts.length === 1 && ROOT_EXCLUSIONS.has(firstSegment)) return false;

  return true;
}

/**
 * Copies the repository's .claude directory contents into a worktree's
 * .claude directory. Safe to call against a destination that already
 * exists (the normal case, since `git worktree add` checks tracked
 * .claude/ files out first) and idempotent across repeated calls (REQ-2).
 *
 * @param {string} repoRoot - the primary checkout's root path
 * @param {string} worktreePath - the newly created worktree's root path
 */
export function copyClaudeDir(repoRoot, worktreePath) {
  const claudeSrc = join(repoRoot, '.claude');
  const claudeDest = join(worktreePath, '.claude');

  if (!existsSync(claudeSrc)) return;

  cpSync(claudeSrc, claudeDest, {
    recursive: true,
    filter: (src) => {
      const relPath = src.slice(claudeSrc.length).split(sep).join('/').replace(/^\/+/, '');
      return shouldCopyClaudeEntry(relPath);
    }
  });

  // Self-healing (REQ-3), the part the filter above cannot reach: when a
  // repository's own .claude/.claude is TRACKED in git (as this repo's main
  // branch currently is, pending this track's own cleanup phase),
  // `git worktree add` checks that nested content out into the destination
  // directly, before this function ever runs — the filter above only
  // controls what OUR copy adds, it cannot un-write what git already
  // materialized. Remove it explicitly so a worktree is never left with
  // inherited nesting regardless of which mechanism put it there.
  const nestedDest = join(claudeDest, '.claude');
  if (existsSync(nestedDest)) {
    rmSync(nestedDest, { recursive: true, force: true });
  }
}
