// Track AM-10093 Phase 1/3: reproduces the stale DB->disk pull revert (R4
// in spec.md) and pins the fix (db-pull-guard.mjs) into updateIndexMDFromDB.
//
// Direct unit coverage of the pure decision (shouldSkipLaneOnPull) covers
// the actual logic; laneconductor.sync.mjs boots a whole worker on import
// (same constraint as every other test file in this suite), so the wiring
// itself is verified via source-level pins, same established pattern as
// track-10046's and this track's own stale-dispatch-clobber suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldSkipLaneOnPull } from '../services/db-pull-guard.mjs';

const SYNC_SRC = readFileSync(new URL('../laneconductor.sync.mjs', import.meta.url), 'utf8');

// ── TC-1.3 / TC-3.1: mtime advanced since the pull decision ───────────────
test('TC-1.3/TC-3.1: mtime advanced between decision and write — lane skipped', () => {
  const r = shouldSkipLaneOnPull({ decisionMtime: 1000, currentMtime: 5000, timestampComparison: 'newer' });
  assert.equal(r.skip, true);
  assert.equal(r.reason, 'mtime_advanced_since_pull_decision');
});

test('TC-3.1 (negative): mtime unchanged since decision — lane not skipped on this ground', () => {
  const r = shouldSkipLaneOnPull({ decisionMtime: 1000, currentMtime: 1000, timestampComparison: 'newer' });
  assert.equal(r.skip, false);
});

// ── TC-1.4 / TC-3.2: ambiguous tie — file wins ─────────────────────────────
test('TC-1.4/TC-3.2: compareTimestamps equal — file wins, lane pull skipped', () => {
  const r = shouldSkipLaneOnPull({ decisionMtime: 1000, currentMtime: 1000, timestampComparison: 'equal' });
  assert.equal(r.skip, true);
  assert.equal(r.reason, 'ambiguous_timestamp_tie_file_wins');
});

// ── TC-3.3: a genuine human UI drag must still apply (regression guard) ───
test('TC-3.3: DB strictly newer, file untouched since decision — pull still applies (must not regress legitimate forward sync)', () => {
  const r = shouldSkipLaneOnPull({ decisionMtime: 1000, currentMtime: 1000, timestampComparison: 'newer' });
  assert.equal(r.skip, false, 'a legitimate, unambiguous DB-is-newer pull (e.g. a human dragging a card forward in the UI) must not be blocked by this guard');
});

// ── TC-3.5: content_summary_mismatch-only trigger with file as fresher side
// is exercised the same way as TC-3.2 — 'equal' comparison, file wins ─────
test('TC-3.5: comparison equal regardless of what triggered the pull — lane still skipped', () => {
  const r = shouldSkipLaneOnPull({ decisionMtime: 2000, currentMtime: 2000, timestampComparison: 'equal' });
  assert.equal(r.skip, true);
});

// ── decisionMtime null (no mtime available) must never itself trigger a skip
test('missing decisionMtime does not trigger the mtime-advance branch (only the tie-break can still fire)', () => {
  const r = shouldSkipLaneOnPull({ decisionMtime: null, currentMtime: null, timestampComparison: 'newer' });
  assert.equal(r.skip, false);
});

// ── Wiring pins: updateIndexMDFromDB must actually call the guard, and the
// call site must thread mtime/comparison from the SAME values the pull
// decision (shouldPullFromDB / compareTimestamps in pullTracksMetadataFromDB)
// already computed, re-stat immediately before, not reused from far earlier.
test('updateIndexMDFromDB consults shouldSkipLaneOnPull before writing the Lane marker', () => {
  assert.ok(SYNC_SRC.includes('shouldSkipLaneOnPull('), 'updateIndexMDFromDB must route its lane-write decision through the shared guard');
});

test('the guard call site re-stats the file (getFileModTime) rather than reusing the decision-time mtime for currentMtime', () => {
  const guardCallIdx = SYNC_SRC.indexOf('shouldSkipLaneOnPull(');
  const nearby = SYNC_SRC.slice(Math.max(0, guardCallIdx - 400), guardCallIdx);
  assert.ok(nearby.includes('getFileModTime(indexPath)'), 'currentMtime must come from a fresh stat immediately before the guard call, not from the earlier decisionMtime read');
});

test('pullTracksMetadataFromDB threads its own decision-time mtime and comparison into updateIndexMDFromDB', () => {
  const callIdx = SYNC_SRC.indexOf('updateIndexMDFromDB(fullTrackFolder, track,');
  assert.ok(callIdx !== -1, 'the call site must pass a pullContext object, not call updateIndexMDFromDB with only 2 args (which would silently disable the guard)');
  const callLine = SYNC_SRC.slice(callIdx, SYNC_SRC.indexOf('\n', callIdx));
  assert.ok(callLine.includes('decisionMtime: indexMtime'));
  assert.ok(callLine.includes('timestampComparison: comparison'));
});
