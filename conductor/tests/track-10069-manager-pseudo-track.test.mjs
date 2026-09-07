// conductor/tests/track-10069-manager-pseudo-track.test.mjs
// Track 10069 Phase 4: the pure reserved-name module shared by every branch
// that needs to recognize the manager pseudo-track (worker dirs-filter,
// resolveTrackFolder, the Collector API's comments routes).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MANAGER_PSEUDO_TRACK, isManagerPseudoTrack, shouldAdmitManagerPseudoTrack } from '../services/manager-pseudo-track.mjs';

test('MANAGER_PSEUDO_TRACK is the literal reserved name, no digit anywhere (10067 REQ-21)', () => {
  assert.equal(MANAGER_PSEUDO_TRACK, 'manager');
  assert.doesNotMatch(MANAGER_PSEUDO_TRACK, /\d/);
});

test('isManagerPseudoTrack matches only the exact reserved string', () => {
  assert.equal(isManagerPseudoTrack('manager'), true);
  assert.equal(isManagerPseudoTrack('Manager'), false);
  assert.equal(isManagerPseudoTrack('10067-manager-thing'), false);
  assert.equal(isManagerPseudoTrack('manager-supervision'), false);
  assert.equal(isManagerPseudoTrack(''), false);
  assert.equal(isManagerPseudoTrack(undefined), false);
});

test('shouldAdmitManagerPseudoTrack: true only when Waiting for reply is yes', () => {
  assert.equal(shouldAdmitManagerPseudoTrack('**Waiting for reply**: yes\n'), true);
  assert.equal(shouldAdmitManagerPseudoTrack('**Waiting for reply**: YES\n'), true);
  assert.equal(shouldAdmitManagerPseudoTrack('**Waiting for reply**: no\n'), false);
  assert.equal(shouldAdmitManagerPseudoTrack('# Manager\n\nno marker at all\n'), false);
  assert.equal(shouldAdmitManagerPseudoTrack(''), false);
  assert.equal(shouldAdmitManagerPseudoTrack(null), false);
});
