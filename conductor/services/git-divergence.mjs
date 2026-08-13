// conductor/services/git-divergence.mjs
// Track 1112 Phase 5: the only git-network call anywhere in the codebase
// used to be a single `git fetch` buried inside git-lock claiming
// (laneconductor.sync.mjs:3108), and nothing ever looked at its result — a
// third party pushing straight to `origin/main`, bypassing LaneConductor
// entirely, was invisible to every worker. This module detects that
// divergence on its own schedule and, only when provably safe (D-4), pulls
// it in with a real `git merge --ff-only` — never a bare `git pull`, which
// can silently start a three-way merge nobody asked for.
//
// Unlike the Phase 3 worktree-merge primitive, a fast-forward pull here
// does NOT need a scratch worktree: `mainBranch` is expected to already be
// checked out in `repoRoot` (that's the whole point — we're updating the
// branch a human/worker actually has open), so running the merge directly
// there is the normal, safe case `git merge --ff-only` exists for. The
// safety work is entirely in deciding WHETHER to run it at all.

import { execFileSync } from 'node:child_process';
import { resolvePrimaryRepoRoot } from './worktree-merge.mjs';

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

/**
 * Fetches `origin/<mainBranch>` (read-only) and reports ahead/behind counts
 * between local `mainBranch` and the remote-tracking ref. Never mutates
 * anything beyond the fetch itself (which only updates remote-tracking
 * refs, not `mainBranch`).
 *
 * Returns { fetchOk, ahead, behind, canFastForward, repoRoot, mainBranch,
 * remoteRef } — `canFastForward` is true only when local is strictly
 * behind with zero unpushed local commits (ahead === 0 && behind > 0).
 */
export async function checkDivergence({ repoRoot, mainBranch = 'main' }) {
  repoRoot = resolvePrimaryRepoRoot(repoRoot);

  const fetchOk = gitQuiet(['fetch', 'origin', mainBranch, '--quiet'], repoRoot) !== null;
  if (!fetchOk) {
    return { fetchOk: false, ahead: null, behind: null, canFastForward: false, repoRoot, mainBranch };
  }

  const remoteRef = `origin/${mainBranch}`;
  if (gitQuiet(['rev-parse', '--verify', remoteRef], repoRoot) === null) {
    return { fetchOk: true, ahead: 0, behind: 0, canFastForward: false, repoRoot, mainBranch, remoteRef, noRemoteBranch: true };
  }

  const counts = git(['rev-list', '--left-right', '--count', `${mainBranch}...${remoteRef}`], repoRoot).trim();
  const [aheadStr, behindStr] = counts.split(/\s+/);
  const ahead = parseInt(aheadStr, 10) || 0;
  const behind = parseInt(behindStr, 10) || 0;
  const canFastForward = ahead === 0 && behind > 0;

  return { fetchOk: true, ahead, behind, canFastForward, repoRoot, mainBranch, remoteRef };
}

/**
 * Pulls `origin/<mainBranch>` into `mainBranch` — but only when ALL of
 * D-4's conditions hold: strictly behind with no local-only commits, fast-
 * forward possible, and no path the incoming commits touch is currently
 * dirty in `repoRoot`. Anything else is refused with a reason, and nothing
 * is mutated.
 *
 * Returns one of:
 *   { pulled: true, beforeSha, afterSha, changedTrackFiles, divergence }
 *   { pulled: false, reason: 'fetch-failed'|'up-to-date'|'diverged'|
 *     'auto-pull-disabled'|'merge-failed', divergence }
 *   { pulled: false, reason: 'dirty-overlap', overlapPaths, divergence }
 */
export async function safePull({ repoRoot, mainBranch = 'main', autoPull = true }) {
  const divergence = await checkDivergence({ repoRoot, mainBranch });
  repoRoot = divergence.repoRoot;

  if (!divergence.fetchOk) return { pulled: false, reason: 'fetch-failed', divergence };
  if (divergence.behind === 0) return { pulled: false, reason: 'up-to-date', divergence };
  if (!divergence.canFastForward) return { pulled: false, reason: 'diverged', divergence };
  if (!autoPull) return { pulled: false, reason: 'auto-pull-disabled', divergence };

  const { remoteRef } = divergence;
  const incomingPaths = (gitQuiet(['diff', '--name-only', `${mainBranch}..${remoteRef}`], repoRoot) ?? '')
    .split('\n').map(l => l.trim()).filter(Boolean);
  const dirtyPaths = new Set(
    (gitQuiet(['status', '--porcelain'], repoRoot) ?? '')
      .split('\n').map(l => l.slice(3).trim()).filter(Boolean)
  );
  const overlapPaths = incomingPaths.filter(p => dirtyPaths.has(p));
  if (overlapPaths.length > 0) {
    return { pulled: false, reason: 'dirty-overlap', overlapPaths, divergence };
  }

  const beforeSha = git(['rev-parse', mainBranch], repoRoot).trim();
  try {
    // --ff-only: refuses (throws) rather than starting a merge/rebase if,
    // for any reason, a fast-forward isn't actually possible at this
    // instant — the repo is left exactly as it was.
    git(['merge', '--ff-only', remoteRef], repoRoot);
  } catch {
    return { pulled: false, reason: 'merge-failed', divergence };
  }
  const afterSha = git(['rev-parse', mainBranch], repoRoot).trim();

  const changedTrackFiles = (gitQuiet(['diff', '--name-only', beforeSha, afterSha, '--', 'conductor/tracks/'], repoRoot) ?? '')
    .split('\n').map(l => l.trim()).filter(f => f.endsWith('index.md'));

  return { pulled: true, beforeSha, afterSha, changedTrackFiles, divergence };
}
