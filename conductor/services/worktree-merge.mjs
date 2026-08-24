// conductor/services/worktree-merge.mjs
// Track 1112 Phase 3 (RC-A / D-5 / REQ-7): the one shared merge primitive
// used by the heartbeat reconciler, the exit-handler fast path, and
// `lc worktrees merge` — no second copy of this logic exists anywhere.
//
// Why a scratch worktree, and why it's detached rather than on `main`:
// the primary checkout normally already has `mainBranch` checked out, and
// git refuses to check the same branch out in two worktrees at once
// (confirmed empirically: `git branch -f main <sha>` errors with "cannot
// force update the branch ... used by worktree at ..." even from another
// worktree). So the merge happens in a fresh, detached-HEAD scratch
// worktree instead — detached HEADs don't collide with anything.
//
// Why the primary checkout still needs a resync step after the ref moves:
// also confirmed empirically — `git update-ref refs/heads/<main> <new>`
// silently succeeds even though `mainBranch` is checked out in the primary
// worktree (unlike `git branch -f`, `update-ref` has no worktree-awareness
// at all), but it leaves that worktree's index physically stale relative
// to the new HEAD tree: every path the merge changed now shows up as a
// spurious staged diff in `git status`, even though nothing in the working
// directory moved. Left alone, that breaks REQ-7/AC-6 (primary checkout's
// `git status --porcelain` must be byte-identical across a merge). The fix
// is to check out just the touched-and-clean paths afterward — which
// brings the primary index and working tree back in line with the new
// HEAD for exactly the files that changed, without ever running `git
// merge`/`git reset` against the primary's own dirty state. Paths that are
// ALSO locally dirty in the primary checkout are deliberately skipped,
// which is what makes a dirty-overlap merge (REQ-5, TC-3.6) still safe:
// the human's uncommitted edit is left completely untouched either way.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { validatePathIsolation } from './path-isolation.mjs';
import { isSafeToAutoResolveBookkeepingConflict } from './track-metadata-conflict.mjs';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function gitQuiet(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

// The primary checkout is the only worktree where `--git-dir` and
// `--git-common-dir` resolve to the same path — every linked worktree's
// `--git-dir` is `.git/worktrees/<name>` (a real, distinct directory)
// while `--git-common-dir` always points at the shared `.git`. Works from
// any worktree's cwd, since all of them share the same object database.
export function resolvePrimaryRepoRoot(fromDir) {
  const gitDir = git(['rev-parse', '--path-format=absolute', '--git-dir'], fromDir).trim();
  const gitCommonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], fromDir).trim();
  if (gitDir === gitCommonDir) return fromDir; // already the primary
  // gitCommonDir is <primary>/.git — its parent is the primary checkout root.
  return dirname(gitCommonDir);
}

/**
 * Merges `track-<trackNumber>` into `mainBranch` inside `repoRoot`, never
 * running a mutating git command against the primary checkout's own
 * branch/index beyond the deliberate, narrow resync described above.
 *
 * Also removes the track's own per-track worktree (`<repoRoot>/.worktrees/
 * <trackNumber>` — NOT the ephemeral scratch one) if present, as part of
 * the same call, before attempting to delete the branch. This isn't
 * optional cosmetic ordering: found live, the hard way — `git branch -d`
 * silently fails (git refuses to delete a branch checked out in another
 * worktree, the same guard proven earlier against `git branch -f`) whenever
 * the original per-track worktree still exists at delete time. A caller
 * that removes that worktree only *after* calling this function leaves the
 * branch merged-but-undeleted with no visible error (a bare `gitQuiet`
 * swallows it) — confirmed against this repo's own real tracks 1053/1069.
 *
 * Returns one of:
 *   { merged: true, mergeCommit, worktreeRemoved: boolean }
 *   { merged: false, reason: 'no-branch' }
 *   { merged: false, reason: 'conflict', conflictPaths: string[] }
 */
export async function mergeWorktreeBranch({ repoRoot, trackNumber, mainBranch = 'main' }) {
  // Found live, the hard way, against this repo's own tracks 1053/1069:
  // a caller can legitimately be running from INSIDE a linked worktree
  // (this session's own cwd is one) rather than the true primary checkout
  // — `findProjectRoot()`-style "walk up looking for a conductor/ dir"
  // helpers resolve to the FIRST directory that looks like a project root,
  // which a linked worktree also satisfies (it's a full checkout). If
  // `repoRoot` isn't actually the primary, every guarantee this file
  // exists for (AC-6's byte-identical status, "never touches the shared
  // checkout") silently applies to the WRONG directory — the real primary
  // checkout's index never gets resynced at all, and drifts. Resolved
  // here, once, so no caller has to get this right on its own: the
  // primary is the only worktree where `--git-dir` and `--git-common-dir`
  // agree (a linked worktree's `--git-dir` is `.git/worktrees/<name>`,
  // always different from the shared `--git-common-dir`).
  repoRoot = resolvePrimaryRepoRoot(repoRoot);

  const branch = `track-${trackNumber}`;

  if (gitQuiet(['rev-parse', '--verify', branch], repoRoot) === null) {
    return { merged: false, reason: 'no-branch' };
  }

  const scratchId = `.merge-${process.pid}-${trackNumber}`;
  const worktreesDir = join(repoRoot, '.worktrees');
  const scratchPath = validatePathIsolation(scratchId, join(worktreesDir, scratchId), repoRoot);
  if (!existsSync(worktreesDir)) mkdirSync(worktreesDir, { recursive: true });

  const oldMainSha = git(['rev-parse', mainBranch], repoRoot).trim();
  // Must be captured BEFORE update-ref moves mainBranch — afterward, the
  // primary checkout's own status already shows every merge-touched path
  // as dirty (the exact artifact this resync exists to clean up), which
  // would make that artifact look indistinguishable from a genuine
  // pre-existing human edit and get "protected" (skipped) by mistake.
  const dirtyPathsBeforeMerge = new Set(
    (gitQuiet(['status', '--porcelain'], repoRoot) ?? '')
      .split('\n').map(l => l.slice(3).trim()).filter(Boolean)
  );

  try {
    git(['worktree', 'add', '--detach', '-q', scratchPath, oldMainSha], repoRoot);

    try {
      git(['merge', '--no-ff', branch, '-m', `Merge track ${trackNumber}`], scratchPath);
    } catch {
      const conflictPaths = (gitQuiet(['diff', '--name-only', '--diff-filter=U'], scratchPath) ?? '')
        .split('\n').map(l => l.trim()).filter(Boolean);

      // Track 1114 Phase 17: a conflict limited entirely to this track's
      // own conductor/tracks/<N>-*/ bookkeeping files isn't real work to
      // lose — it's the periodic DB->FS sync writing this same track's
      // status header directly onto main while its own branch does the
      // same independently. The branch's copy is the authoritative
      // completion record; resolve by taking it, exactly like a human
      // would (`git checkout --theirs`), and finish the merge instead of
      // aborting. Any OTHER conflicting path (real code) still aborts.
      if (isSafeToAutoResolveBookkeepingConflict({ repoRoot, mainBranch, branch, conflictPaths, trackNumber })) {
        for (const p of conflictPaths) {
          git(['checkout', '--theirs', '--', p], scratchPath);
          git(['add', '--', p], scratchPath);
        }
        git(['commit', '--no-edit'], scratchPath);
      } else {
        gitQuiet(['merge', '--abort'], scratchPath);
        return { merged: false, reason: 'conflict', conflictPaths };
      }
    }

    const newMainSha = git(['rev-parse', 'HEAD'], scratchPath).trim();

    // Compare-and-swap: fails loudly (throws) if `mainBranch` moved since
    // we read oldMainSha — e.g. a concurrent reconciliation pass or a
    // human's own commit — rather than silently clobbering it.
    git(['update-ref', `refs/heads/${mainBranch}`, newMainSha, oldMainSha], repoRoot);

    resyncPrimaryCheckout(repoRoot, mainBranch, oldMainSha, newMainSha, dirtyPathsBeforeMerge);

    // Remove the ORIGINAL per-track worktree (if any) BEFORE deleting the
    // branch — see the doc comment above for why the order matters.
    const originalWorktreePath = join(worktreesDir, String(trackNumber));
    let worktreeRemoved = false;
    if (existsSync(originalWorktreePath)) {
      worktreeRemoved = gitQuiet(['worktree', 'remove', '--force', originalWorktreePath], repoRoot) !== null;
    }

    // Only ever `-d` (safe/ancestor-checked), never `-D` — deleting is a
    // no-op-safe cleanup, not something a failed delete should escalate.
    gitQuiet(['branch', '-d', branch], repoRoot);

    return { merged: true, mergeCommit: newMainSha, worktreeRemoved };
  } finally {
    if (existsSync(scratchPath)) {
      gitQuiet(['worktree', 'remove', '--force', scratchPath], repoRoot);
    }
    gitQuiet(['worktree', 'prune'], repoRoot);
  }
}

// Brings the primary checkout's index/working tree back in line with the
// newly-advanced `mainBranch` for exactly the paths the merge touched —
// skipping anything currently dirty there. See the file-level comment for
// why this specific, narrow resync (rather than a full checkout/reset) is
// what keeps `git status --porcelain` byte-identical across a clean merge
// while still leaving an overlapping dirty file completely untouched.
function resyncPrimaryCheckout(repoRoot, mainBranch, oldMainSha, newMainSha, dirtyPaths) {
  const touchedPaths = (gitQuiet(['diff', '--name-only', oldMainSha, newMainSha], repoRoot) ?? '')
    .split('\n').map(l => l.trim()).filter(Boolean);
  if (touchedPaths.length === 0) return;

  for (const path of touchedPaths) {
    if (dirtyPaths.has(path)) continue; // leave the human's uncommitted work alone
    const existsInNewMain = gitQuiet(['cat-file', '-e', `${newMainSha}:${path}`], repoRoot) !== null;
    if (existsInNewMain) {
      gitQuiet(['checkout', mainBranch, '--', path], repoRoot);
    } else {
      gitQuiet(['rm', '--cached', '--ignore-unmatch', '--', path], repoRoot);
      try { rmSync(join(repoRoot, path), { force: true }); } catch { /* best-effort */ }
    }
  }
}
