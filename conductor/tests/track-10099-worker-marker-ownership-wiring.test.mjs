// conductor/tests/track-10099-worker-marker-ownership-wiring.test.mjs
// Track AM-10099 Phase 11 Task 2 (item k): closes the other half of Phase
// 7's "both writers enforce it" requirement (TC-7.4). Phase 7 wired
// conductor/services/marker-ownership.mjs into the API server's
// syncTrackToFile (see ui/server/tests/track-10099-marker-ownership.test.mjs)
// but never into the worker's own updateIndexMDFromDB — confirmed live: that
// function wrote `**Merge Mode**` (an AUTHOR_OWNED_MARKERS entry) straight
// from `dbTrack.merge_mode` with no ownership check at all, from the single
// call site in pullTracksMetadataFromDB's per-track loop, which is exactly
// the "generic/coarse sync" case marker-ownership.mjs's own header says must
// never carry an author-owned marker onto the file.
//
// laneconductor.sync.mjs boots a whole worker on import (same constraint as
// every other test file in this suite — see track-10093-stale-db-pull-revert
// for the established pattern this file follows), so this is a source-level
// wiring pin, not a live import, matching how the sibling Lane-write guard
// (shouldSkipLaneOnPull) is already pinned in that same file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAuthorOwnedMarker, isMachineOwnedMarker } from '../services/marker-ownership.mjs';

const SYNC_SRC = readFileSync(new URL('../laneconductor.sync.mjs', import.meta.url), 'utf8');

test('sanity: Merge Mode is classified as author-owned (the marker this incident is about)', () => {
  assert.equal(isAuthorOwnedMarker('Merge Mode'), true);
});

test('updateIndexMDFromDB imports from marker-ownership.mjs', () => {
  assert.ok(
    SYNC_SRC.includes("from './services/marker-ownership.mjs'"),
    'the worker\'s DB->FS writer must consume the shared ownership table, the same way syncTrackToFile does — see marker-ownership.mjs\'s own header, which already claims this and was wrong until this fix'
  );
});

test('updateIndexMDFromDB does not write **Merge Mode** unconditionally from dbTrack.merge_mode', () => {
  // Isolate the function body so a coincidental match elsewhere in this
  // 10,000+ line file can't produce a false pass.
  const fnStart = SYNC_SRC.indexOf('function updateIndexMDFromDB(');
  assert.ok(fnStart !== -1, 'updateIndexMDFromDB must still exist under this name');
  const nextFnStart = SYNC_SRC.indexOf('\nfunction ', fnStart + 1);
  const fnBody = SYNC_SRC.slice(fnStart, nextFnStart === -1 ? undefined : nextFnStart);

  // The old, unguarded line this test would have failed against:
  //   if (dbTrack.merge_mode) {
  //     content = updateMarker(content, 'Merge Mode', dbTrack.merge_mode);
  //   }
  // A bare `if (dbTrack.merge_mode)` with no ownership/provenance check
  // anywhere in the same guarded block is exactly the bug.
  const mergeModeBlockMatch = fnBody.match(/if\s*\(dbTrack\.merge_mode[^)]*\)\s*{([\s\S]{0,400}?)\n\s*}/);
  if (mergeModeBlockMatch) {
    const block = mergeModeBlockMatch[0];
    assert.ok(
      /isAuthorOwnedMarker|AUTHORED_MARKER_PROVENANCE|provenance/.test(block),
      `updateIndexMDFromDB's Merge Mode write must consult marker ownership before applying dbTrack.merge_mode — found unguarded block:\n${block}`
    );
  }
  // If the whole conditional shape changed (e.g. Merge Mode was moved out
  // of updateIndexMDFromDB into a shared helper both writers call), that's
  // also an acceptable fix — assert the function-level import requirement
  // above covers that case; this test only fails on the exact unguarded
  // shape being reproduced again.
});

test('every marker updateIndexMDFromDB can write is classified as author- or machine-owned (item l)', () => {
  const fnStart = SYNC_SRC.indexOf('function updateIndexMDFromDB(');
  const nextFnStart = SYNC_SRC.indexOf('\nfunction ', fnStart + 1);
  const fnBody = SYNC_SRC.slice(fnStart, nextFnStart === -1 ? undefined : nextFnStart);

  // Markers this function is known to touch via updateMarker(content, 'X', ...)
  const writtenMarkers = [...fnBody.matchAll(/updateMarker\(content,\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(writtenMarkers.length > 0, 'sanity: the function should write at least one marker via updateMarker');

  for (const marker of writtenMarkers) {
    assert.ok(
      isAuthorOwnedMarker(marker) || isMachineOwnedMarker(marker),
      `marker "${marker}" is written by updateIndexMDFromDB but classified in neither table — add it to marker-ownership.mjs (item l). This is expected to currently fail for "Summary", which is the track-1081 incident's own marker.`
    );
  }
});
