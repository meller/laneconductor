// Track 10040 Phase 2 (REQ-12, Finding 4): reproduces the live incident
// end-to-end against the REAL production code path — applyGuardedLaneWrite
// is the exact function laneconductor.sync.mjs's exit-handler write site
// and its DB->disk pull site both call (see conductor/services/
// lane-regression-guard.mjs), not a mirror or reimplementation of it.

import { test } from 'node:test';
import assert from 'node:assert';
import { applyGuardedLaneWrite } from '../services/lane-regression-guard.mjs';

const SHIPPED_TRACK_INDEX = `# Track 10036: Fix stale tracks-metadata cache

**Lane**: done
**Lane Status**: queue
**Progress**: 100%
**Type**: dev
**Summary**: Shipped.
`;

test('TC-73 (AC-11): a stale in-memory view cannot write implement:success over an on-disk done:queue', () => {
  // Reproduces the live incident: a worker's own in-memory `laneStatus`
  // said 'implement' (stale — it started the run before track 10036
  // reached done), so its exit handler wants to write
  // implement:success. The real, current on-disk state is done:queue —
  // the merge action already ran. producedByThisRun is false because the
  // freshly-read on-disk lane ('done') does not match what this stale
  // run itself was executing in ('implement').
  const result = applyGuardedLaneWrite(SHIPPED_TRACK_INDEX, {
    intendedLane: 'implement',
    intendedStatus: 'success',
    producedByThisRun: false,
  });

  assert.equal(result.blocked, true);
  assert.match(result.reason, /done/);
  // index.md content is untouched — still done:queue, not implement:success.
  assert.equal(result.content, SHIPPED_TRACK_INDEX);
  assert.match(result.content, /\*\*Lane\*\*:\s*done/);
  assert.match(result.content, /\*\*Lane Status\*\*:\s*queue/);
  assert.doesNotMatch(result.content, /implement/);
});

test('TC-74: the guard reads fresh from content, not a caller-cached value — a file mutated mid-flight is respected', () => {
  const original = `# Track 999\n\n**Lane**: review\n**Lane Status**: running\n`;
  // Simulate "the file changed since this run started executing" by
  // constructing the post-mutation content directly and passing THAT —
  // applyGuardedLaneWrite has no memory of the original; it only ever
  // looks at what's passed to it right now.
  const mutatedMidRun = original.replace('**Lane**: review', '**Lane**: done');

  const result = applyGuardedLaneWrite(mutatedMidRun, {
    intendedLane: 'implement',
    intendedStatus: 'queue',
    producedByThisRun: false, // this run started in 'review', not 'done'
  });

  assert.equal(result.blocked, true, 'must respect the mutated (done) state, not an original (review) snapshot');
});

test('TC-73b: a legitimate on_failure regression (review -> implement:queue) still writes normally', () => {
  const content = `# Track 1\n\n**Lane**: review\n**Lane Status**: running\n`;
  const result = applyGuardedLaneWrite(content, {
    intendedLane: 'implement',
    intendedStatus: 'queue',
    producedByThisRun: true, // on-disk lane (review) matches what this run executed in
  });

  assert.equal(result.blocked, false);
  assert.match(result.content, /\*\*Lane\*\*:\s*implement/);
  assert.match(result.content, /\*\*Lane Status\*\*:\s*queue/);
});

test('TC-73c: forward completion (implement -> review:queue) writes normally', () => {
  const content = `# Track 1\n\n**Lane**: implement\n**Lane Status**: running\n`;
  const result = applyGuardedLaneWrite(content, {
    intendedLane: 'review',
    intendedStatus: 'queue',
    producedByThisRun: false,
  });

  assert.equal(result.blocked, false);
  assert.match(result.content, /\*\*Lane\*\*:\s*review/);
});
