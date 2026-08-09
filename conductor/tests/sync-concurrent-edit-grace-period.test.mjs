#!/usr/bin/env node
// conductor/tests/sync-concurrent-edit-grace-period.test.mjs
// Bug: pullTracksMetadataFromDB's concurrent-edit grace period never
// expires. isConcurrentEdit(fileMtime, dbLastUpdated) only compares the two
// stored timestamps to each other (are they within 10s of each other?) —
// it never checks whether that pair of events is itself recent relative to
// now. Any track whose file mtime and DB last_updated happened to land
// within 10s of each other (the normal case right after any successful
// sync) gets permanently stuck: every 5s heartbeat cycle re-evaluates the
// same two frozen timestamps, finds them still <10s apart, and skips the
// DB→FS pull forever — logging "concurrent_edit_grace_period" on every
// cycle indefinitely (observed: one project's conductor/.sync.log grew to
// 3.7GB from this, and its track 180 sat un-synced for hours).
//
// Run: node --test conductor/tests/sync-concurrent-edit-grace-period.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isConcurrentEdit } from '../sync-timestamp-utils.mjs';

describe('isConcurrentEdit', () => {
  it('returns false when either timestamp is missing', () => {
    assert.equal(isConcurrentEdit(null, Date.now()), false);
    assert.equal(isConcurrentEdit(Date.now(), null), false);
  });

  it('treats a genuinely fresh, still-in-flight race as concurrent', () => {
    const now = Date.now();
    const fileMtime = now - 2000;   // file touched 2s ago
    const dbLastUpdated = now - 1700; // DB touched 1.7s ago — 300ms apart, both recent
    assert.equal(isConcurrentEdit(fileMtime, dbLastUpdated), true);
  });

  it('BUG: does not treat an old-but-close timestamp pair as still concurrent hours later', () => {
    // This is track 180's exact real-world shape: file and DB timestamps
    // ~483ms apart, but both from over 3 hours ago — nothing is "in
    // flight," the race (if it ever was one) resolved long ago.
    const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
    const fileMtime = threeHoursAgo;
    const dbLastUpdated = threeHoursAgo + 483;
    assert.equal(
      isConcurrentEdit(fileMtime, dbLastUpdated),
      false,
      'a stale-but-close timestamp pair must not be treated as an active race — this is what permanently wedges DB→FS sync'
    );
  });

  it('returns false when timestamps are far apart, regardless of age', () => {
    const now = Date.now();
    assert.equal(isConcurrentEdit(now, now - 60_000), false); // 60s apart, recent
  });
});
