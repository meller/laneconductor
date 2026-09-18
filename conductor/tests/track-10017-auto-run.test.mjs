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

  // Track AM-10099 Phase 6 (item d, REQ-6/REQ-7): `explicitlyRequested` —
  // true only for `lc worker run <track>`'s bounded `--only-tracks ...
  // --once` shape, never for an ordinary `--only-tracks`-scoped standing
  // worker.
  it('AC-9: autoRun false, explicitlyRequested true — claimable (the whole point of `lc worker run` on an Auto Run: no track)', () => {
    assert.equal(
      isTrackClaimable('42', { autoRun: false, explicitlyRequested: true }),
      true
    );
  });

  it('REQ-7 regression: autoRun false, onlyTracks contains this track, explicitlyRequested FALSE — still NOT claimable', () => {
    // This is the exact case an ordinary `lc worker start --sync-and-work
    // --only-tracks 42` produces: onlyTracks narrows, but with no --once
    // there is no isClaimScopedOnceRun, so explicitlyRequested must stay
    // false and the Auto Run gate must still apply. --only-tracks alone
    // must never widen past auto_run:false (REQ-7) — proven distinct from
    // AC-9 above only by explicitlyRequested's value.
    assert.equal(
      isTrackClaimable('42', { autoRun: false, onlyTracks: new Set(['42']), explicitlyRequested: false }),
      false
    );
  });

  it('explicitlyRequested does not widen onlyTracks — a track outside the allowlist stays excluded even when explicitly requested', () => {
    // explicitlyRequested only bypasses the autoRun check; it must never
    // make onlyTracks or claimableSet more permissive (both are separate
    // permission decisions this parameter has no business overriding).
    assert.equal(
      isTrackClaimable('42', { autoRun: true, onlyTracks: new Set(['99']), explicitlyRequested: true }),
      false
    );
  });

  it('explicitlyRequested does not widen claimableSet — an assignee-excluded track stays excluded even when explicitly requested', () => {
    assert.equal(
      isTrackClaimable('42', { autoRun: true, claimableSet: new Set(['99']), explicitlyRequested: true }),
      false
    );
  });
});
