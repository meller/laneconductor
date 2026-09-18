// conductor/services/marker-ownership.mjs
// Track AM-10099 Phase 7 (item e, REQ-8): the shared classification of
// which index.md markers belong to the author/human and which belong to
// the machine — used by every DB→FS writer (the worker's
// updateIndexMDFromDB and the Collector API's syncTrackToFile) so the two
// can never independently drift on the question "who owns this marker".
//
// Confirmed live on this very track: syncTrackToFile's `**Auto Run**`
// write unconditionally applied whatever the DB row said, and a DB row
// can be wrong for reasons that have nothing to do with the author's
// actual intent (see spec.md item (g)/(e) — a junk track's default
// value survived into this track's own row and overwrote a
// deliberately-committed `**Auto Run**: no`). The fix is not "never let
// the DB update these markers" — a human/UI action genuinely needs
// `/auto-run`'s own PATCH to reach the file — it's "a DB→FS writer must
// not treat merely HOLDING a value as license to apply it"; only a
// caller asserting AUTHORED_MARKER_PROVENANCE for this exact write may.
// See `AUTHORED_MARKER_PROVENANCE` below.

// Author-owned: set by a human (directly, or via a dedicated single-
// purpose action route), never inferred, never safe to blank on absence.
export const AUTHOR_OWNED_MARKERS = Object.freeze([
  'H1', // the `# Track NNN: Title` heading line, not a `**Marker**:` line
  'Problem',
  'Type',
  'Author',
  'Created By',
  'Auto Run',
  'Merge Mode',
  'Workspace',
  'Depends On',
]);

// Machine-owned: written by whichever lane action / sync cycle last ran;
// always safe to overwrite with the DB's current value.
export const MACHINE_OWNED_MARKERS = Object.freeze([
  'Lane',
  'Lane Status',
  'Progress',
  'Phase',
]);

/**
 * The provenance token a caller must pass alongside an author-owned
 * marker's new value to actually have it written. Exists so "the DB
 * happens to hold a value" and "a human/UI just deliberately set this
 * value through its own dedicated action" are never conflated — only the
 * latter may reach the file. A generic/coarse sync (a full-row pull, a
 * future bulk-mirroring path) never has this and so can never silently
 * carry a stale or corrupted author-owned value onto the file, REGARDLESS
 * of how that value ended up in the DB row.
 *
 * Not a real secret — a plain sentinel string is enough, since the only
 * thing being guarded against is an ACCIDENTAL, un-asserted write, not a
 * malicious one (every caller here is this codebase's own trusted code).
 */
export const AUTHORED_MARKER_PROVENANCE = 'human-action';

export function isAuthorOwnedMarker(markerName) {
  return AUTHOR_OWNED_MARKERS.includes(markerName);
}

export function isMachineOwnedMarker(markerName) {
  return MACHINE_OWNED_MARKERS.includes(markerName);
}
