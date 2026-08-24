// conductor/tests/track-1109-claim-allowlist.test.mjs
// Track 1109: worker claim allowlist — scoped worker invocation.
//
// The predicate under test is deliberately extracted into
// conductor/claim-scope.mjs rather than tested through the whole worker:
// laneconductor.sync.mjs is a script with side effects on import (timers,
// registration), so it can only be exercised as a subprocess. Same pattern
// as claude-cli-args.mjs.
//
// The assertions that matter here are the NEGATIVE ones — that a scoped
// worker leaves unlisted tracks alone, and that the allowlist can only
// narrow. A suite proving only "it claims what it was told to" would pass
// against a no-op implementation.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseOnlyTracks, isTrackClaimable } from '../claim-scope.mjs';

describe('Track 1109: --only-tracks parsing', () => {
  it('TC-3: parses a csv into a set, tolerating whitespace', () => {
    assert.deepEqual(parseOnlyTracks(['--only-tracks', '42, 43 ,44']), new Set(['42', '43', '44']));
  });

  it('TC-3b: absent flag yields null (meaning "no restriction")', () => {
    assert.equal(parseOnlyTracks(['--sync-and-work']), null);
  });

  it('TC-3c: normalises numeric forms so 042 and 42 are the same track', () => {
    assert.deepEqual(parseOnlyTracks(['--only-tracks', '042,1100']), new Set(['42', '1100']));
  });

  it('TC-3d: an empty or comma-only value is an error, not "allow everything"', () => {
    // Silently degrading to null here would turn a typo into a worker that
    // consumes the whole queue — the exact failure this track prevents.
    assert.throws(() => parseOnlyTracks(['--only-tracks', '']), /only-tracks/i);
    assert.throws(() => parseOnlyTracks(['--only-tracks', ' , ']), /only-tracks/i);
  });

  it('TC-3e: a missing value (flag at end of argv) is an error', () => {
    assert.throws(() => parseOnlyTracks(['--only-tracks']), /only-tracks/i);
  });
});

describe('Track 1109: claim gate', () => {
  // autoRun: true opts these fixtures out of track 10017's separate,
  // default-closed auto-run gate so this suite continues to isolate the
  // allowlist/claimableSet behavior it was written to test — see
  // track-10017-auto-run.test.mjs for the auto-run gate's own coverage.
  const base = { claimableSet: null, onlyTracks: null, waitingForReply: false, autoRun: true };

  it('TC-9: no allowlist and no claimableSet → unchanged (claimable)', () => {
    assert.equal(isTrackClaimable('42', base), true);
  });

  it('TC-9b: no allowlist → claimableSet behaves exactly as before', () => {
    const claimableSet = new Set(['42']);
    assert.equal(isTrackClaimable('42', { ...base, claimableSet }), true);
    assert.equal(isTrackClaimable('43', { ...base, claimableSet }), false);
  });

  it('TC-4: a listed track is claimable', () => {
    assert.equal(isTrackClaimable('42', { ...base, onlyTracks: new Set(['42']) }), true);
  });

  it('TC-5: an UNLISTED track is left alone — the point of the track', () => {
    assert.equal(isTrackClaimable('43', { ...base, onlyTracks: new Set(['42']) }), false);
  });

  it('TC-6: the allowlist applies in local-fs mode, where claimableSet is null', () => {
    assert.equal(isTrackClaimable('43', { ...base, claimableSet: null, onlyTracks: new Set(['42']) }), false);
    assert.equal(isTrackClaimable('42', { ...base, claimableSet: null, onlyTracks: new Set(['42']) }), true);
  });

  it('TC-7: narrows only — never widens claimableSet', () => {
    // Server said no. An operator flag must not override that.
    assert.equal(
      isTrackClaimable('43', { ...base, claimableSet: new Set(['42']), onlyTracks: new Set(['43']) }),
      false
    );
  });

  it('TC-7b: both must allow it', () => {
    assert.equal(
      isTrackClaimable('42', { ...base, claimableSet: new Set(['42']), onlyTracks: new Set(['42']) }),
      true
    );
  });

  it('TC-8: waitingForReply bypasses claimableSet but NOT the allowlist', () => {
    // The existing gate deliberately lets mid-conversation tracks through
    // the assignee check. If the allowlist were bypassed the same way, a
    // scoped worker would answer arbitrary tracks and the guarantee would
    // be worthless.
    assert.equal(
      isTrackClaimable('43', { claimableSet: new Set(['42']), onlyTracks: null, waitingForReply: true }),
      true,
      'claimableSet is bypassed for waitingForReply (existing behaviour)'
    );
    assert.equal(
      isTrackClaimable('43', { claimableSet: null, onlyTracks: new Set(['42']), waitingForReply: true }),
      false,
      'allowlist must still apply to a waiting-for-reply track'
    );
  });

  it('TC-5b: track numbers compare consistently regardless of zero padding', () => {
    assert.equal(isTrackClaimable('042', { ...base, onlyTracks: new Set(['42']) }), true);
  });
});

describe('Track 1109: --once / scope helpers', () => {
  it('TC-10: scoped work is finished when no listed track remains claimable', async () => {
    const { isScopedWorkFinished } = await import('../claim-scope.mjs');
    assert.equal(isScopedWorkFinished({ onlyTracks: new Set(['42']), runningCount: 0, remainingClaimable: new Set() }), true);
  });

  it('TC-11: NOT finished while a scoped track is still running', async () => {
    const { isScopedWorkFinished } = await import('../claim-scope.mjs');
    assert.equal(
      isScopedWorkFinished({ onlyTracks: new Set(['42']), runningCount: 1, remainingClaimable: new Set() }),
      false,
      'must never exit mid-track'
    );
  });

  it('TC-11b: NOT finished while a listed track is still claimable', async () => {
    const { isScopedWorkFinished } = await import('../claim-scope.mjs');
    assert.equal(
      isScopedWorkFinished({ onlyTracks: new Set(['42']), runningCount: 0, remainingClaimable: new Set(['42']) }),
      false
    );
  });

  it('TC-12: an unscoped worker is never "finished" — lifecycle stays orthogonal', async () => {
    const { isScopedWorkFinished } = await import('../claim-scope.mjs');
    assert.equal(
      isScopedWorkFinished({ onlyTracks: null, runningCount: 0, remainingClaimable: new Set() }),
      false
    );
  });
});
