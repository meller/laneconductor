import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOrphanedDispatch } from '../services/orphaned-dispatch.mjs';

// Same shape as this repo's own conductor/workflow.json — see
// track-1110-orphaned-dispatch.test.mjs's own comment for why a fixture
// rather than the real file.
const WORKFLOW_FIXTURE = {
  lanes: {
    plan: { on_success: 'plan:success', on_failure: 'backlog' },
    implement: { on_success: 'review:queue', on_failure: 'implement:failure' },
    review: { on_success: 'quality-gate:queue', on_failure: 'implement:queue' },
    'quality-gate': { on_success: 'done:success', on_failure: 'plan:queue' },
  },
};

describe('classifyOrphanedDispatch — Track 10020 Phase 3: crashed-run detection (runnerExited)', () => {
  it('TC-3.1: a CLI that exited (runnerExited: true) while Lane Status is still "running" is a crash — failed, skip artifact copy, flag for human, name the action to re-run', () => {
    const r = classifyOrphanedDispatch({ laneStatus: 'running', runnerExited: true, lane: 'implement', action: 'implement' });
    assert.equal(r.orphaned, true);
    assert.equal(r.status, 'failed');
    assert.equal(r.skipArtifactCopy, true);
    assert.equal(r.flagForHuman, true);
    assert.match(r.result, /implement/);
  });

  it('TC-3.2: runnerExited: false with Lane Status "running" is unchanged — still genuinely in progress', () => {
    assert.deepEqual(
      classifyOrphanedDispatch({ laneStatus: 'running', runnerExited: false, lane: 'implement', action: 'implement' }),
      { orphaned: false },
    );
  });

  it('TC-3.3 (REQ-6): runnerExited omitted entirely with Lane Status "running" is byte-identical to today — no-marker callers see zero change', () => {
    assert.deepEqual(
      classifyOrphanedDispatch({ laneStatus: 'running', lane: 'implement', action: 'implement' }),
      { orphaned: false },
    );
  });

  it('TC-3.4: runnerExited: true with a terminal Lane Status ("success") is normal success classification, NOT the crash path — a finished run that merely lost its exit handler is not a crash', () => {
    const r = classifyOrphanedDispatch({ laneStatus: 'success', runnerExited: true, lane: 'implement', action: 'implement' });
    assert.equal(r.orphaned, true);
    assert.equal(r.status, 'done');
    assert.ok(!r.flagForHuman);
    assert.ok(!r.skipArtifactCopy);
  });

  it('TC-3.5: existing lane/action-mismatch cases (tracks 10014/1117) are unchanged when runnerExited: true — the mismatch branch still wins', () => {
    // Track 10014's own incident (stale EARLIER lane's success), replayed
    // with runnerExited: true added — must classify identically to the
    // existing (no-runnerExited) test in track-1110-orphaned-dispatch.
    const stale = classifyOrphanedDispatch({ laneStatus: 'success', lane: 'plan', action: 'implement', runnerExited: true });
    assert.equal(stale.orphaned, true);
    assert.equal(stale.status, 'failed');
    assert.equal(stale.skipArtifactCopy, true);
    assert.match(stale.result, /implement/);
    assert.match(stale.result, /plan/);

    // Track 1117 Bug 2's forward-transition case (implement -> review is a
    // legal on_success target) — still trusted and copied, runnerExited
    // doesn't change this since Lane Status isn't "running" here either.
    const forward = classifyOrphanedDispatch({
      laneStatus: 'queue', lane: 'review', action: 'implement', workflowConfig: WORKFLOW_FIXTURE, runnerExited: true,
    });
    assert.equal(forward.orphaned, true);
    assert.equal(forward.status, 'done');
    assert.ok(!forward.skipArtifactCopy);
  });
});
