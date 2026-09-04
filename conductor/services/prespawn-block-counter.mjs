// conductor/services/prespawn-block-counter.mjs
// Track 10060 Phase 2 (REQ-2,3,4,5): the storage layer for the pre-spawn
// block streak counter that decidePreSpawnBlockOutcome (prespawn-block.mjs)
// decides on.
//
// Why this exists, from track 10060's spec Finding 3: in local-api/remote-api
// the streak lives in `tracks.prespawn_block_count`, written by
// POST /track/:num/prespawn-block. Those columns come from
// ui/server/migrations/013_track_10040_prespawn_block.sql, and NOTHING in this
// repo applies ui/server/migrations/*.sql automatically — no runner exists in
// ui/server/index.mjs or bin/lc.mjs. On any database where 013 was never
// applied by hand, that endpoint returns 500, and handlePreSpawnBlock used to
// respond by hardcoding `countBefore = 0` ("treating as first-of-streak").
//
// The intent of that fail-safe was right — never escalate a track to failure
// on a guessed count. Its effect was not: it pinned EVERY block at
// first-of-streak, which makes escalation structurally unreachable. A
// permanently-blocked main-mode track then retries forever, re-posting ⚠️ on
// every cycle and never reaching a terminal state a human would notice. That
// is exactly the shape observed on track 10051, which blocked twice, reported
// `warn` both times, and never escalated.
//
// The fix is not to guess: it is to fall back to the same durable sibling-file
// counter that local-fs mode has always used. It lives beside the track's own
// files, survives worker restarts, and carries the same cause-change reset
// semantics — so escalation stays reachable in every mode, without ever
// inventing a number.
//
// I/O is confined to the two sibling files; the API call is injected by the
// caller so this module stays testable without a collector.

import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const COUNT_FILE = '.prespawn-block-count';
export const KIND_FILE = '.prespawn-block-kind';

// Named here rather than inlined in the warning so a reader can grep either
// the constant or the emitted log line and land in the same place.
export const COUNTER_BACKEND_MIGRATION_PATH = 'ui/server/migrations/013_track_10040_prespawn_block.sql';

// Greppable tag on the emitted warning — REQ-4 wants this failure to be its
// own condition in the log, not a clause folded into the generic block line.
export const COUNTER_BACKEND_WARNING_TAG = 'prespawn-counter-backend-unavailable';

function readIfExists(path) {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

/**
 * Reads the current streak length for `kind`, then records this block.
 *
 * Cause-change reset (REQ-3): a block of a different kind is a different
 * streak, not a continuation — same guard the exit handler's `.retry-lane`
 * counter applies to lane changes.
 *
 * @returns {number} the streak length BEFORE this block (0 = first of streak)
 */
export function readAndIncrementBlockCount(tracksDir, trackDirName, kind) {
  if (!tracksDir || !trackDirName) return 0;
  const countPath = join(tracksDir, trackDirName, COUNT_FILE);
  const kindPath = join(tracksDir, trackDirName, KIND_FILE);

  const lastKind = readIfExists(kindPath);
  const parsed = parseInt(readIfExists(countPath) || '0', 10);
  const previous = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  const countBefore = lastKind === kind ? previous : 0;

  try {
    writeFileSync(countPath, String(countBefore + 1), 'utf8');
    writeFileSync(kindPath, kind, 'utf8');
  } catch {
    // Best-effort: an unwritable track folder must never turn a block into a
    // crash. The count simply doesn't advance, which fails toward "warn".
  }
  return countBefore;
}

/** Clears the streak. Safe to call unconditionally, including with no folder. */
export function resetBlockCount(tracksDir, trackDirName) {
  if (!tracksDir || !trackDirName) return;
  for (const name of [COUNT_FILE, KIND_FILE]) {
    const path = join(tracksDir, trackDirName, name);
    try {
      if (existsSync(path)) rmSync(path);
    } catch { /* best-effort */ }
  }
}

/**
 * Resolves the streak length before this block, from whichever backend is
 * actually available.
 *
 * @param {object} opts
 * @param {boolean} opts.useApi - false in local-fs mode (no collector to ask)
 * @param {() => Promise<{count?: number}>} opts.recordViaApi - injected collector call
 * @param {string|null} opts.tracksDir
 * @param {string|null} opts.trackDirName
 * @param {string} opts.kind - one of BLOCK_KINDS
 * @returns {Promise<{countBefore: number, source: 'api'|'fs'|'fs-fallback'|'none', backendError: Error|null}>}
 *   `source` is what the caller gates its one-per-streak backend warning on:
 *   'fs-fallback' means the collector failed and this count came from disk;
 *   'none' means the collector failed and there was nowhere to persist a
 *   count, so first-of-streak is the only honest answer.
 */
export async function resolveBlockCountBefore({ useApi, recordViaApi, tracksDir, trackDirName, kind }) {
  if (!useApi) {
    return { countBefore: readAndIncrementBlockCount(tracksDir, trackDirName, kind), source: 'fs', backendError: null };
  }
  try {
    const res = await recordViaApi();
    return { countBefore: Math.max(0, (res?.count ?? 1) - 1), source: 'api', backendError: null };
  } catch (err) {
    if (!tracksDir || !trackDirName) {
      return { countBefore: 0, source: 'none', backendError: err };
    }
    return {
      countBefore: readAndIncrementBlockCount(tracksDir, trackDirName, kind),
      source: 'fs-fallback',
      backendError: err,
    };
  }
}

/** The distinct, greppable warning REQ-4 asks for. */
export function formatCounterBackendWarning(err) {
  return `[${COUNTER_BACKEND_WARNING_TAG}] the collector's prespawn-block counter is unavailable (${err?.message ?? 'unknown error'}) — `
    + `falling back to the on-disk streak counter so escalation stays reachable. `
    + `Most likely cause: ${COUNTER_BACKEND_MIGRATION_PATH} has never been applied to this database `
    + `(nothing applies ui/server/migrations/*.sql automatically).`;
}
