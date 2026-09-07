// conductor/services/done-lane-bucket.mjs
// Track 10076: the single place that decides what "bucket" a done-lane
// track renders under — replacing the two independent computations that
// used to disagree (KanbanBoard.jsx's DONE_LANE_STATUS_CONFIG, driven only
// by lane_action_status, vs. worktree-audit.mjs's git/GitHub-derived
// classification, which the Worktrees panel trusts). Confirmed live on
// track 10065: a done-lane merge that FAILED (lane_action_status=
// 'failure') was invisible under the board's "Unmerged" heading while the
// Worktrees panel correctly still showed it as needing a merge.
//
// Pure module, no I/O — same style as merge-mode.mjs and
// done-lane-migration.mjs — so both the React board (KanbanBoard.jsx,
// LaneFocusView.jsx) and this module's own unit tests can use it without
// pulling in a browser or a git checkout.
//
// THE CENTRAL DESIGN CONSTRAINT (read this before touching the priority
// order below): a track's git classification can be UNAVAILABLE — no
// worker has reported live worktree state in the last 60s (worker
// stopped, local-fs mode, a fresh restart still auditing) — and this is
// NOT the same as "nothing to merge". Treating an unavailable
// classification as evidence of "merged" would make a stopped worker
// silently report every unmerged track as shipped, which is worse than
// the bug this module exists to fix. `classificationAvailable` must
// always gate the override; a `worktreeClass` value alone is never
// trusted without it.

// The git/GitHub classifications (see worktree-audit.mjs's own doc
// comment for the full enum) that mean "this done-lane track's code has
// NOT actually shipped yet" — as opposed to 'open' (not yet in the done
// lane) or 'detached' (not a track branch at all, never applicable here).
// Exported so done-lane-migration.mjs's planDoneLaneMigration() can import
// the same set rather than keeping its own inline copy — the migration
// sweep (`lc worktrees migrate-done-lane`) and this live classifier must
// never be able to disagree about what "unmerged" means.
export const UNMERGED_CLASSIFICATIONS = ['mergeable', 'stranded', 'conflicted', 'pr-open'];

// Verbatim today's base per-lane_action_status config (unchanged from the
// pre-track-10076 KanbanBoard.jsx). Every non-done lane always renders
// from this table; the done lane falls back to it too whenever the git
// classification can't override (see resolveDoneLaneBucket below).
export const LANE_STATUS_CONFIG = {
  waiting: { emoji: '⌛', label: 'Waiting', color: 'text-gray-500', show: true },
  queue: { emoji: '⏳', label: 'Queued', color: 'text-yellow-500', show: true },
  running: { emoji: '🔄', label: 'Running', color: 'text-blue-500', show: true },
  success: { emoji: '✅', label: 'Success', color: 'text-green-500', show: true },
  failure: { emoji: '❌', label: 'Failed', color: 'text-red-500', show: true },
};

// Track 10035's done-lane-only label overrides, kept verbatim (including
// the ffeaf510 `failure` stopgap entry) as the FALLBACK table used only
// when the git classification is unavailable (REQ-4/REQ-8) — this is no
// longer a second, independent mechanism, just resolveDoneLaneBucket's
// degraded-signal path.
export const DONE_LANE_STATUS_CONFIG = {
  queue: { emoji: '🔀', label: 'Unmerged', color: 'text-orange-400', show: true },
  waiting: { emoji: '🔵', label: 'PR open', color: 'text-blue-400', show: true },
  failure: { emoji: '🔀', label: 'Unmerged — merge failed', color: 'text-orange-400', show: true },
};

const GIT_PR_OPEN = { bucket: 'pr-open', source: 'git', emoji: '🔵', label: 'PR open', color: 'text-blue-400', show: true };
const GIT_UNMERGED = { bucket: 'unmerged', source: 'git', emoji: '🔀', label: 'Unmerged', color: 'text-orange-400', show: true };
const GIT_UNMERGED_FAILED = { bucket: 'unmerged-failed', source: 'git', emoji: '🔀', label: 'Unmerged — merge failed', color: 'text-orange-400', show: true };

const FALLBACK_DONE_CONFIG = { ...LANE_STATUS_CONFIG, ...DONE_LANE_STATUS_CONFIG };

/**
 * Resolves the display bucket for one track. Returns `null` for any lane
 * other than 'done' — callers keep using LANE_STATUS_CONFIG directly for
 * everything else; this module only has an opinion about the done lane.
 *
 * @param {Object} params
 * @param {string} params.laneStatus - track.lane_status
 * @param {string} params.laneActionStatus - track.lane_action_status
 * @param {string|null} params.worktreeClass - track.worktree_class (the
 *   live git/GitHub classification from worktree-audit.mjs, as surfaced by
 *   GET /api/projects/:id/tracks)
 * @param {boolean} params.classificationAvailable - track.worktree_class_available
 *   — true only when a live worker actually reported worktree state this
 *   cycle. MUST be explicitly true for worktreeClass to override anything;
 *   see the module-level design constraint above.
 * @returns {{bucket: string, source: 'git'|'lane_action_status', emoji: string, label: string, color: string, show: boolean}|null}
 */
export function resolveDoneLaneBucket({ laneStatus, laneActionStatus, worktreeClass, classificationAvailable }) {
  if (laneStatus !== 'done') return null;

  const status = laneActionStatus || 'waiting';

  if (classificationAvailable && UNMERGED_CLASSIFICATIONS.includes(worktreeClass)) {
    if (worktreeClass === 'pr-open') return GIT_PR_OPEN;
    return status === 'failure' ? GIT_UNMERGED_FAILED : GIT_UNMERGED;
  }

  const config = FALLBACK_DONE_CONFIG[status] || LANE_STATUS_CONFIG.waiting;
  return { bucket: status, source: 'lane_action_status', ...config };
}
