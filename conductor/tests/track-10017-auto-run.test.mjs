// conductor/tests/track-10017-auto-run.test.mjs
// Track 10017: per-track auto-run gate for the sync+poll worker's
// auto-launch loop.
//
// Extracted predicate under test (isTrackClaimable in claim-scope.mjs) —
// same rationale as track-1109-claim-allowlist.test.mjs: laneconductor.sync.mjs
// is a script with side effects on import, so the decision logic is tested
// in isolation here.
//
// The case that matters most is TC-4: --only-tracks (an allowlist meant to
// NARROW only) must not widen past auto_run:false. That's the most likely
// place a "widen instead of narrow" regression would land.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTrackClaimable } from '../claim-scope.mjs';

describe('Track 10017: auto-run gate', () => {
  it('TC-1: autoRun false, no other options — not claimable (default: off)', () => {
    assert.equal(isTrackClaimable('42', { autoRun: false }), false);
  });

  it('TC-2: autoRun true — claimable (all other gates open)', () => {
    assert.equal(isTrackClaimable('42', { autoRun: true }), true);
  });

  it('TC-3: autoRun false, waitingForReply true — claimable (bypass)', () => {
    assert.equal(isTrackClaimable('42', { autoRun: false, waitingForReply: true }), true);
  });

  it('TC-4: autoRun false, onlyTracks contains this track — still NOT claimable', () => {
    // --only-tracks narrows only; it must not widen past auto_run:false.
    assert.equal(
      isTrackClaimable('42', { autoRun: false, onlyTracks: new Set(['42']) }),
      false
    );
  });

  it('TC-5: autoRun true, claimableSet does NOT contain this track — still NOT claimable', () => {
    // auto_run is an additional condition, not a replacement for the
    // pre-existing assignee gate.
    assert.equal(
      isTrackClaimable('42', { autoRun: true, claimableSet: new Set(['43']) }),
      false
    );
  });
});
