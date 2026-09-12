// conductor/services/db-pull-guard.mjs
// Track AM-10093 (REQ-5/REQ-6): pullTracksMetadataFromDB's DB→disk pull
// decides whether to write **Lane** from a `compareTimestamps` call made
// BEFORE pullTrackContentFromDB/syncConversationFromDB's own awaits run for
// this same track, and before updateIndexMDFromDB's own earlier I/O. A
// stale-but-genuinely-newer DB row (e.g. one written moments ago by the
// stale-dispatch clobber this track's R1/R2/R3 fix closes) can overwrite a
// file edit that landed in that window, because a forward lane write was
// previously never blocked at all (only the backwards case was guarded).
//
// This module is the pure decision this hazard closes: re-check the mtime
// that justified pulling in the first place, and treat an ambiguous tie as
// "the file wins" rather than as a green light. Pure module, no I/O —
// mirrors dispatch-revalidation.mjs's and lane-regression-guard.mjs's
// extraction style.

/**
 * Decides whether the Lane portion of a DB->disk pull should be skipped.
 *
 * @param {object} opts
 * @param {number|null} opts.decisionMtime - index.md's mtime (ms) at the
 *   moment the pull was decided to be needed (`shouldPullFromDB`'s read).
 * @param {number|null} opts.currentMtime - index.md's mtime (ms) re-read
 *   immediately before the write actually happens. `null` when there was
 *   nothing to compare against (e.g. decisionMtime itself was null).
 * @param {'newer'|'older'|'equal'} opts.timestampComparison - the result
 *   `compareTimestamps` returned for this pull (DB vs. file).
 * @returns {{skip: boolean, reason: string|null}}
 */
export function shouldSkipLaneOnPull({ decisionMtime, currentMtime, timestampComparison }) {
  // REQ-5: the file changed again after the decision was made — someone
  // wrote something real in the window between "we decided to pull" and
  // "we're about to write". Never write over a change we haven't even
  // looked at yet.
  if (decisionMtime != null && currentMtime != null && currentMtime > decisionMtime) {
    return { skip: true, reason: 'mtime_advanced_since_pull_decision' };
  }

  // REQ-6: `compareTimestamps`'s 'equal' band is a ±1ms tolerance, not
  // evidence the DB is correct. When neither side is definitively newer,
  // the file wins rather than the pull acting as an unconditional
  // tie-breaking forward write.
  if (timestampComparison === 'equal') {
    return { skip: true, reason: 'ambiguous_timestamp_tie_file_wins' };
  }

  return { skip: false, reason: null };
}
