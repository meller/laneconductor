// conductor/claim-scope.mjs
// Track 1109: claim scoping for the heartbeat worker.
// Track 10017: adds a second, independent gate — a track's own opt-in
// `auto_run` flag (parsed from index.md's `**Auto Run**` marker) — on top
// of the allowlist below.
//
// Extracted rather than inlined into laneconductor.sync.mjs so it can be
// unit-tested directly — that file is a script with side effects on import
// (timers, registration), so it can only be exercised as a subprocess. Same
// reasoning as claude-cli-args.mjs.
//
// Background: `lc worker start --sync-and-work` claims anything queued.
// The server-side gate (GET /api/projects/:id/claimable-tracks) is
// identity-derived — assignee_uid ?? created_by_uid ?? owner_uid — and in a
// no-auth local deployment all three are null, so it takes its
// "no owner info at all — open claim" branch and admits everything. This
// module adds an operator-supplied allowlist that does not depend on
// identities and therefore also works in local-fs mode.

/**
 * Normalise a track number for comparison. Track directories are `NNN-slug`
 * and numbers appear zero-padded ("042") in some places and bare ("42") in
 * others; comparing raw strings would silently fail to match.
 */
function normaliseTrackNumber(value) {
  const s = String(value).trim();
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
}

/**
 * Parse `--only-tracks <csv>` out of argv.
 *
 * Returns a Set of normalised track numbers, or null when the flag is
 * absent (meaning "no restriction" — today's behaviour).
 *
 * Throws on a present-but-unusable value. Degrading a typo to null would
 * turn `--only-tracks ""` into a worker that consumes the entire queue,
 * which is precisely the accident this flag exists to prevent — so it fails
 * loudly instead.
 */
export function parseOnlyTracks(argv = []) {
  const idx = argv.indexOf('--only-tracks');
  if (idx === -1) return null;

  const raw = argv[idx + 1];
  if (raw === undefined || raw.startsWith('--')) {
    throw new Error('--only-tracks requires a comma-separated list of track numbers (e.g. --only-tracks 1100,1109)');
  }

  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('--only-tracks was given an empty list — omit the flag entirely to run unscoped');
  }

  return new Set(parts.map(normaliseTrackNumber));
}

/**
 * The claim predicate.
 *
 * @param trackNumber        the track being considered
 * @param claimableSet       server-side gate (Set), or null for "unrestricted"
 *                           — null in local-fs mode and before registration
 * @param onlyTracks         operator allowlist (Set), or null for "no allowlist"
 * @param waitingForReply    track is mid-conversation with a human
 * @param autoRun            the track's own opt-in flag (index.md's
 *                           `**Auto Run**` marker / DB `auto_run` column).
 *                           Defaults to false — a track with no indicator is
 *                           not auto-picked (track 10017).
 *
 * The allowlist NARROWS ONLY: it can never make claimable something the
 * server excluded. An operator flag must not be able to widen a
 * permission decision. The same rule applies to `autoRun` — `onlyTracks`
 * naming a track does not bypass its `autoRun: false`; use
 * `lc worker run <track>` to force a specific run regardless of this gate.
 *
 * Note the deliberate asymmetry on waitingForReply. The pre-existing gate
 * bypasses `claimableSet` (and now `autoRun`) for tracks mid-conversation,
 * so a track already being answered doesn't get stranded by assignee/auto-run
 * gating. The allowlist is NOT bypassed the same way — if it were, a worker
 * scoped to track 42 would still answer arbitrary other tracks, and the
 * scoping guarantee would be worthless exactly when it matters.
 */
export function isTrackClaimable(trackNumber, { claimableSet = null, onlyTracks = null, waitingForReply = false, autoRun = false } = {}) {
  const n = normaliseTrackNumber(trackNumber);

  if (onlyTracks && !onlyTracks.has(n)) return false;

  if (!autoRun && !waitingForReply) return false;

  if (claimableSet && !waitingForReply) {
    const allowed = claimableSet.has(n) || claimableSet.has(String(trackNumber).trim());
    if (!allowed) return false;
  }

  return true;
}

/**
 * `--once` termination check: has a scoped worker run out of work?
 *
 * Only ever true for a scoped worker — an unscoped one has no bounded set of
 * work and must not self-terminate. Never true while something is still
 * running, so the worker cannot exit mid-track.
 */
export function isScopedWorkFinished({ onlyTracks = null, runningCount = 0, remainingClaimable = null } = {}) {
  if (!onlyTracks) return false;
  if (runningCount > 0) return false;
  if (remainingClaimable && remainingClaimable.size > 0) return false;
  return true;
}
