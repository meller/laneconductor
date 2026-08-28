// conductor/services/done-lane-migration.mjs
// Track 10035 REQ-11: one-time migration sweep, run once via
// `lc worktrees migrate-done-lane` (see bin/lc.mjs).
//
// Two independent corrections, both driven off auditWorktrees()'s
// already-resolved per-track state (git-committed content is the
// authority for both):
//
//   1. A track sitting at done:success with a live unmerged branch is a
//      pre-track-10035 artifact — done:success used to be written at
//      quality-gate exit, before anything actually merged. Move it to
//      done:queue so the standard merge action (re-)claims it, same as
//      every other unmerged done-lane track.
//   2. tracks.merge_mode in the DB can disagree with the file's own
//      **Merge Mode** marker (track 1119's clobber loop, found live) — the
//      file always wins; this corrects the DB value to match.
//
// planDoneLaneMigration() is pure (no I/O) so the decision logic is
// testable without a real git repo or DB — see
// conductor/tests/track-10035-migration.test.mjs. The caller (bin/lc.mjs)
// owns applying the plan: file writes/commits, conversation.md comments,
// and collector PATCH calls.

/**
 * @param {Array} rows auditWorktrees() output — trackNumber, lane,
 *   laneStatus, classification, mergeMode (file-resolved) per row.
 * @param {Object} dbMergeModeByTrack trackNumber -> the DB's current
 *   tracks.merge_mode value, for the correct-merge-mode action. Omit a key
 *   (or pass {}) when the DB isn't reachable (e.g. local-fs mode) — no
 *   merge_mode actions are planned for a track missing from this map.
 * @returns {Array<{trackNumber: string, type: 'requeue-done-success'|'correct-merge-mode', reason: string, from?: string, to?: string}>}
 */
export function planDoneLaneMigration(rows, dbMergeModeByTrack = {}) {
  const actions = [];
  for (const row of rows) {
    if (!row.trackNumber) continue; // detached rows have no track to act on

    const genuinelyUnmerged = ['mergeable', 'stranded', 'conflicted', 'pr-open'].includes(row.classification);
    if (genuinelyUnmerged && row.lane === 'done' && row.laneStatus === 'success') {
      actions.push({
        trackNumber: row.trackNumber,
        type: 'requeue-done-success',
        reason: `done:success with a live unmerged branch (classification: ${row.classification}) — pre-track-10035 state; moving to done:queue so the merge action claims it`,
      });
    }

    const dbMergeMode = dbMergeModeByTrack[row.trackNumber];
    if (dbMergeMode != null && dbMergeMode !== row.mergeMode) {
      actions.push({
        trackNumber: row.trackNumber,
        type: 'correct-merge-mode',
        from: dbMergeMode,
        to: row.mergeMode,
        reason: `DB merge_mode ('${dbMergeMode}') disagreed with the file's **Merge Mode** marker ('${row.mergeMode}') — file wins`,
      });
    }
  }
  return actions;
}
