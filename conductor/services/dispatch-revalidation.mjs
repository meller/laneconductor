// conductor/services/dispatch-revalidation.mjs
// Track AM-10093 (REQ-1): autoLaunchLocalFs takes a snapshot of a track's
// index.md ONCE at the top of its per-directory loop iteration, then
// awaits several seconds of I/O (buildCliArgs's session resolution,
// POST /tracks/claim-queue, up to one 3000ms-timeout GET per non-primary
// collector) before ever spawning. Nothing re-reads index.md between the
// snapshot and the spawn — so a lane change written into that window (a
// human's lc plan/move, a different worker's own completion) is invisible
// to the dispatch decision, which then confidently spawns the WRONG lane
// action. Confirmed live on track AM-10089 (see this track's spec.md):
// a fresh `lc plan` write landed mid-window and the worker dispatched
// `/laneconductor merge` anyway, from a snapshot that still read
// `done:queue`.
//
// This module is the revalidation gate closing that window: re-read
// index.md immediately before spawning, and abandon the dispatch if
// anything the decision actually depended on has changed. Pure module, no
// I/O — mirrors lane-regression-guard.mjs's and workspace-mode.mjs's
// extraction style so it's testable without pulling in
// laneconductor.sync.mjs's module-load side effects.
//
// Deliberately checks exactly the four fields the dispatch decision reads
// (Lane, Lane Status, Auto Run, Waiting for reply) and nothing else — an
// edit to **Summary** or **Progress** during the window cannot change what
// gets spawned, so treating it as "stale" would defer real work for no
// reason (TC-2.6).

/**
 * @typedef {object} DispatchSnapshot
 * @property {string} lane - **Lane** value the dispatch decision was made from
 * @property {string} laneActionStatus - **Lane Status** value at snapshot time
 * @property {boolean} autoRun - parsed **Auto Run** at snapshot time
 * @property {boolean} waitingForReply - parsed **Waiting for reply** at snapshot time
 */

/**
 * Compares the snapshot a dispatch decision was made from against a freshly
 * re-read view of the same track, immediately before spawning.
 *
 * @param {object} opts
 * @param {DispatchSnapshot} opts.snapshot
 * @param {DispatchSnapshot} opts.fresh
 * @returns {{stale: boolean, changed: string[]}} `changed` names the
 *   human-readable markers (matching their `**Marker**` form) that differ,
 *   for logging (REQ-7) — never empty when `stale` is true.
 */
export function revalidateDispatchSnapshot({ snapshot, fresh }) {
  const changed = [];
  if (snapshot.lane !== fresh.lane) changed.push('Lane');
  if (snapshot.laneActionStatus !== fresh.laneActionStatus) changed.push('Lane Status');
  if (snapshot.autoRun !== fresh.autoRun) changed.push('Auto Run');
  if (snapshot.waitingForReply !== fresh.waitingForReply) changed.push('Waiting for reply');
  return { stale: changed.length > 0, changed };
}

/**
 * Parses the four dispatch-relevant fields out of a raw index.md content
 * string, using the exact same regexes autoLaunchLocalFs's own snapshot
 * read uses — kept here as the single shared definition so the snapshot
 * and the fresh re-read can never silently drift into parsing the file
 * two different ways.
 *
 * @param {string} content - raw index.md text
 * @param {object} opts
 * @param {(content: string) => boolean} opts.parseAutoRun
 * @param {(content: string) => boolean} opts.parseWaitingForReply
 * @returns {DispatchSnapshot}
 */
export function parseDispatchSnapshot(content, { parseAutoRun, parseWaitingForReply }) {
  const laneMatch = content.match(/\*\*Lane\*\*:\s*([^\n]+)/i);
  const statusMatch = content.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i);
  return {
    lane: laneMatch ? laneMatch[1].trim() : null,
    laneActionStatus: statusMatch?.[1]?.trim() ?? 'queue',
    autoRun: parseAutoRun(content),
    waitingForReply: parseWaitingForReply(content),
  };
}
