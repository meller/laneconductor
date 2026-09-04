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

// Track 10060 Phase 4 (REQ-7, spec Findings 2 and 4): generated artifacts that
// are tracked in git and therefore show up as ordinary modified files when they
// drift. `prisma/schema.sql` is written only by `scripts/atlas-prisma.mjs`
// (called only from `scripts/setup-db.mjs`); nothing in the worker, CLI or
// Makefile regenerates it, so its drift on 2026-09-03 came from a human running
// the DB setup script during track 10053's migration work — a one-off in that
// instance, but a class that recurs every time anyone runs that script.
//
// A drifting dump matched none of the conjunctive conditions below, so it
// produced NO guidance while halting every merge in the project. This map
// exists to name what regenerated the file, and nothing more: the value is
// shown to a human, never executed, and never returned as `healable: true`.
// Committing a schema dump unattended is exactly the kind of thing a tool
// should not do — see REQ-8 and the module header's safety boundary.
export const REGENERABLE_ARTIFACTS = Object.freeze({
  'prisma/schema.sql': 'node scripts/atlas-prisma.mjs',
  'cloud/schema.sql': 'node scripts/atlas-prisma.mjs',
});

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

  // Track 10060 (REQ-7): a third, suggestion-only classification, checked
  // before the 'D' gate below because this class is modified-and-tracked, not
  // deleted. It returns `healable: false` like every other non-healable
  // answer — the only difference is that it can say what regenerated the file,
  // so the operator has somewhere to start instead of a bare path name.
  if (porcelainStatus === 'M' && REGENERABLE_ARTIFACTS[path]) {
    const command = REGENERABLE_ARTIFACTS[path];
    return {
      healable: false,
      remedy: null,
      suggestion: command,
      reason: `${path} is a regenerable generated artifact (produced by \`${command}\`), not human WIP — settle it by committing the regenerated dump or reverting it (\`git checkout -- ${path}\`). Not auto-applied: a schema dump is never committed unattended`,
    };
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
