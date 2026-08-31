// conductor/services/stuck-track-sweep.mjs
// Track 10040 Phase 6 (REQ-5, Finding 2/3): a track marked `running` on
// disk with no corresponding agent process and no live DB claim is a
// phantom — it wedges a lane's parallel_limit forever (nothing ever
// re-queues it) with no error and no Inbox entry. Reconciled (reset to
// queue) on first sighting; escalated to failure (via Phase 5's counter,
// kind: 'phantom-running') on a repeat sighting, so a phantom that keeps
// reappearing surfaces to a human instead of silently cycling forever.
//
// Pure module, no I/O — mirrors orphan-worker-detection.mjs's style:
// liveness facts (pids, run markers, DB claims) are all injected.

/**
 * Finds tracks marked `running` on disk with no live agent behind them.
 *
 * @param {object} opts
 * @param {Array<{trackNumber: string, lane: string, ageMs: number, pid?: number}>} opts.fsRunning
 *   - every track currently read as `**Lane Status**: running` on disk
 * @param {Set<number>} [opts.livePids] - agent pids this process knows are alive
 * @param {Record<string, boolean>} [opts.runMarkerLive] - trackNumber -> whether its run marker
 *   (if any) is live, per isRunMarkerLive — precomputed by the caller (which owns the /proc probe)
 * @param {Set<string>} [opts.dbClaims] - trackNumbers with a live DB claim right now
 * @param {number} [opts.graceMs] - minimum age before a running marker is even considered —
 *   claim -> lock -> worktree -> spawn legitimately takes seconds
 * @returns {Array} the phantom subset of fsRunning
 */
export function findPhantomRunningTracks({
  fsRunning,
  livePids = new Set(),
  runMarkerLive = {},
  dbClaims = new Set(),
  graceMs = 5 * 60 * 1000,
}) {
  return fsRunning.filter(track => {
    if (track.ageMs < graceMs) return false;
    if (track.pid && livePids.has(track.pid)) return false;
    if (runMarkerLive[track.trackNumber]) return false;
    if (dbClaims.has(track.trackNumber)) return false;
    return true;
  });
}

/**
 * Classifies a phantom-running sighting. First sighting reconciles
 * (reset to queue, no escalation yet); a repeat sighting of the SAME
 * phantom escalates via Phase 5's counter (kind: 'phantom-running') —
 * the caller determines "repeat" from that counter's own persisted state,
 * not from anything tracked in this module.
 *
 * @param {object} opts
 * @param {boolean} [opts.seenBefore] - true if this track was already reconciled as a
 *   phantom in a prior sweep and is STILL phantom now
 * @returns {{action: 'reconcile'|'escalate'}}
 */
export function classifyPhantom({ seenBefore = false } = {}) {
  return { action: seenBefore ? 'escalate' : 'reconcile' };
}
