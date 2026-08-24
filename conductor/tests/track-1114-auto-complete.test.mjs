// Track 1114: "Complete & Merge" autopilots a track through its remaining
// lane actions (review, quality-gate, ...) and merges once it reaches
// done:success. Decided against retrying a stage that comes back without
// advancing — a lane's own on_failure config can silently requeue the
// SAME lane (retry-eligible failure, not yet max_retries), which looks
// identical to "still working" from a bare Lane-Status read. Comparing
// the lane VALUE before vs after a run is the only reliable signal: if it
// didn't change, something didn't genuinely succeed, and per the explicit
// decision this session (stop and surface it, no auto-retry), that halts
// the whole sequence for a human to look at — same as today's normal
// failure handling, just automated up to the point it broke.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAutoCompleteOutcome } from '../services/auto-complete.mjs';

describe('classifyAutoCompleteOutcome', () => {
  it('waits while the stage is still running', () => {
    const result = classifyAutoCompleteOutcome({ beforeLane: 'review', afterLane: 'review', afterStatus: 'running' });
    assert.deepEqual(result, { action: 'wait' });
  });

  it('advances when the lane genuinely changed', () => {
    const result = classifyAutoCompleteOutcome({ beforeLane: 'implement', afterLane: 'review', afterStatus: 'queue' });
    assert.deepEqual(result, { action: 'advance', nextLane: 'review' });
  });

  it('merges once the lane is done with success', () => {
    const result = classifyAutoCompleteOutcome({ beforeLane: 'quality-gate', afterLane: 'done', afterStatus: 'success' });
    assert.deepEqual(result, { action: 'merge' });
  });

  it('stops if it reached done without success (should not happen, but be conservative)', () => {
    const result = classifyAutoCompleteOutcome({ beforeLane: 'quality-gate', afterLane: 'done', afterStatus: 'failure' });
    assert.equal(result.action, 'stop');
    assert.match(result.reason, /done.*failure/i);
  });

  it('stops when the lane did not change, even if status is "queue" (retry-eligible failure, not a real success)', () => {
    const result = classifyAutoCompleteOutcome({ beforeLane: 'review', afterLane: 'review', afterStatus: 'queue' });
    assert.equal(result.action, 'stop');
    assert.match(result.reason, /review/i);
  });

  it('stops when the lane did not change and status is the explicit "failure" literal', () => {
    const result = classifyAutoCompleteOutcome({ beforeLane: 'implement', afterLane: 'implement', afterStatus: 'failure' });
    assert.equal(result.action, 'stop');
  });
});
