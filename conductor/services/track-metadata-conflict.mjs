// conductor/services/track-metadata-conflict.mjs
import { execFileSync } from 'node:child_process';
// Track 1114 Phase 17: a merge conflict limited entirely to a track's own
// conductor/tracks/<N>-*/ bookkeeping files (index.md, plan.md, spec.md,
// test.md, conversation.md) is not a real conflict to preserve — it's an
// artifact of the periodic DB->FS sync ("chore(track-N): sync files before
// worktree" commits) writing that same track's status header directly onto
// main while its own worktree branch is independently doing the same thing.
// The branch's copy is always the authoritative completion record once the
// branch reaches done:success; main's copy is just a lagging mirror. Found
// live: track 10014 reached done:success but sat unmergeable — classified
// 'conflicted' — purely because of this, requiring manual `git checkout
// --theirs` on exactly these two files to unblock.
//
// Deliberately a whitelist of known bookkeeping filenames, not a bare
// directory-prefix check — conservative on purpose, so nothing outside this
// exact, well-understood case is ever auto-resolved.

const BOOKKEEPING_FILENAMES = new Set(['index.md', 'plan.md', 'spec.md', 'test.md', 'conversation.md']);

/**
 * @param {string[]} conflictPaths - repo-relative paths reported as conflicting
 * @param {string} trackNumber
 * @returns {boolean} true iff conflictPaths is non-empty and every path is
 *   one of this track's own bookkeeping files under its conductor/tracks dir
 */
export function isTrackBookkeepingConflict(conflictPaths, trackNumber) {
  if (!Array.isArray(conflictPaths) || conflictPaths.length === 0) return false;
  const dirPattern = new RegExp(`^conductor/tracks/${trackNumber}-[^/]+/([^/]+)$`);
  return conflictPaths.every(p => {
    const m = p.match(dirPattern);
    return !!m && BOOKKEEPING_FILENAMES.has(m[1]);
  });
}

// Known status-header lines these files' own templates use throughout this
// codebase (`**Lane**: implement`, `**Progress**: 100%`, etc.) — the exact
// fields the periodic DB->FS sync ("chore(track-N): sync files before
// worktree") rewrites on main. Kept separate from a track's own
// human-authored prose (Problem/Solution sections, spec content, plan
// phases) — a conflict there is real content and must still block.
const HEADER_LINE = /^\*\*(Lane|Lane Status|Progress|Summary|Last Run|Phase|Status|Type|Waiting for reply)\*\*:.*$/;

function stripHeaderLines(content) {
  return content.split('\n').filter(l => !HEADER_LINE.test(l.trim())).join('\n');
}

function gitShow(repoRoot, ref, path) {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { cwd: repoRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return null; // path doesn't exist at that ref (added/deleted) — can't confirm header-only, treat conservatively
  }
}

/**
 * The git-aware counterpart to isTrackBookkeepingConflict(): confirms not
 * just that every conflicting path is one of this track's own bookkeeping
 * files, but that main's OWN side of the conflict only ever touched known
 * status-header lines relative to the merge-base — i.e. main's copy is
 * genuinely just the sync-mirror artifact, not a human hand-editing
 * Problem/Solution prose directly on main (which must still block, even
 * though it's the "same" file path). Whatever the branch changed is never
 * restricted — it's the authoritative completion record once done:success.
 * @returns {boolean}
 */
export function isSafeToAutoResolveBookkeepingConflict({ repoRoot, mainBranch, branch, conflictPaths, trackNumber }) {
  if (!isTrackBookkeepingConflict(conflictPaths, trackNumber)) return false;
  let base;
  try {
    base = execFileSync('git', ['merge-base', branch, mainBranch], { cwd: repoRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return false;
  }
  if (!base) return false;
  for (const path of conflictPaths) {
    const baseContent = gitShow(repoRoot, base, path);
    const mainContent = gitShow(repoRoot, mainBranch, path);
    if (baseContent === null || mainContent === null) return false;
    if (stripHeaderLines(baseContent) !== stripHeaderLines(mainContent)) return false;
  }
  return true;
}
