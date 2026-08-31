// conductor/services/dirty-path-heal.mjs
// Track 10040 Phase 7 (REQ-7, Finding 1): the 10036 root cause —
// `ui/node_modules` committed as a symlink, then ignored, so `git status`
// reports `D ui/node_modules` permanently — is trivially fixable and
// provably junk, but needed a human to notice a ❌ comment first. This
// module identifies the narrow class of dirty path that is SAFE to
// propose (or, opt-in, apply) a fix for.
//
// Spec D3's safety boundary is deliberately conjunctive and narrow: a
// path is healable only when ALL of (a) it's deleted-from-worktree, (b)
// it's currently git-ignored, and (c) its basename is on a closed
// allowlist of known build-output directory names. The only remedy this
// module ever emits is an index-only `git rm -r --cached` — never a
// filesystem delete, never a content edit. A tool that wedges tracks
// should not earn unattended write access to the working tree, even in
// the one case its own root cause is provably safe to fix.
//
// Pure module, no I/O — git facts are injected by the caller.

export const HEALABLE_BASENAMES = Object.freeze([
  'node_modules', 'dist', 'build', 'out', '.next', 'coverage', '.venv', '__pycache__', '.turbo',
]);

/**
 * Classifies whether a single dirty path is safe to propose/apply a heal
 * for.
 *
 * @param {object} opts
 * @param {string} opts.path - the porcelain-reported path (repo-relative)
 * @param {string} opts.porcelainStatus - the `git status --porcelain` status code for this path
 *   (e.g. 'D', 'M', '??')
 * @param {boolean} opts.isGitIgnored - result of `git check-ignore` for this path, injected
 * @returns {{healable: boolean, remedy: string|null, reason: string}}
 */
export function classifyHealableDirtyPath({ path, porcelainStatus, isGitIgnored }) {
  // Reject path traversal / absolute paths outright — never even
  // considered, regardless of the other conditions. A remedy must never
  // be able to name something outside the repo.
  if (!path || path.startsWith('/') || path.includes('..')) {
    return { healable: false, remedy: null, reason: `refusing to classify a path outside the repo: ${path}` };
  }

  if (porcelainStatus !== 'D') {
    return { healable: false, remedy: null, reason: `status is '${porcelainStatus}', not deleted-from-worktree ('D') — only a tracked-then-deleted path can be this kind of junk` };
  }

  if (!isGitIgnored) {
    return { healable: false, remedy: null, reason: `${path} is not currently git-ignored — a genuinely deleted tracked file, not ignorable build output` };
  }

  const segments = path.split('/');
  const matchesAllowlist = segments.some(seg => HEALABLE_BASENAMES.includes(seg));
  if (!matchesAllowlist) {
    return { healable: false, remedy: null, reason: `no path segment of '${path}' is on the closed build-output allowlist (${HEALABLE_BASENAMES.join(', ')})` };
  }

  return {
    healable: true,
    remedy: `git rm -r --cached ${path}`,
    reason: `${path} is deleted-from-worktree, git-ignored, and matches the build-output allowlist — safe to untrack`,
  };
}
