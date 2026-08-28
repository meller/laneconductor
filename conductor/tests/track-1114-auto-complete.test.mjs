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

  it('(track 10035) advances into the done lane when quality-gate hands off to done:queue', () => {
    const result = classifyAutoCompleteOutcome({ beforeLane: 'quality-gate', afterLane: 'done', afterStatus: 'queue' });
    assert.deepEqual(result, { action: 'advance', nextLane: 'done' });
  });

  it('(track 10035) completes once the merge action actually merges (done:success)', () => {
    const result = classifyAutoCompleteOutcome({ beforeLane: 'done', afterLane: 'done', afterStatus: 'success' });
    assert.equal(result.action, 'complete');
    assert.match(result.reason, /merged/i);
  });

  it('(track 10035) completes (not stop) when the merge action opens a PR (done:waiting)', () => {
    const result = classifyAutoCompleteOutcome({ beforeLane: 'done', afterLane: 'done', afterStatus: 'waiting' });
    assert.equal(result.action, 'complete');
    assert.match(result.reason, /PR/i);
  });

  it('(track 10035) stops (not infinite-advances) when the merge action itself requeues without merging', () => {
    const result = classifyAutoCompleteOutcome({ beforeLane: 'done', afterLane: 'done', afterStatus: 'queue' });
    assert.equal(result.action, 'stop');
    assert.match(result.reason, /done did not advance/i);
  });

  it('stops if it reached done with an unexpected status (should not happen, but be conservative)', () => {
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
