// Per-track merge mode: 'pr' (open a GitHub PR, wait for human approval) or
// 'direct' (today's auto-merge-on-done). Track 10018.
//
// Extracted as a pure module (no side-effecting imports) so both the sync
// worker (parsing `**Merge Mode**` out of index.md) and this module's own
// unit tests can use it without pulling in laneconductor.sync.mjs's
// import-time side effects — same pattern as parse-status.mjs.
//
// resolveMergeMode() is the ONLY place the NULL/absent → 'pr' default lives.
// A track's DB `merge_mode` column stays NULL when unspecified (rather than
// being backfilled to 'pr' at write time) precisely so "explicitly pr" and
// "never specified" remain distinguishable — this function is where that
// distinction collapses into a single effective value for callers that just
// need to know which path to take.

export const VALID_MODES = ['pr', 'direct'];

export function parseMergeModeMarker(content) {
  const match = content.match(/\*\*Merge Mode\*\*:\s*([a-z]+)/i);
  if (!match) return null;
  const value = match[1].toLowerCase().trim();
  return VALID_MODES.includes(value) ? value : null;
}

export function resolveMergeMode(track) {
  const raw = track?.merge_mode;
  if (raw == null || raw === '') return 'pr';
  const value = String(raw).toLowerCase().trim();
  if (VALID_MODES.includes(value)) return value;
  console.warn(`[merge-mode] Unrecognized merge_mode value "${raw}" — defaulting to 'pr'.`);
  return 'pr';
}
