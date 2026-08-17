import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOrphanedDispatch } from '../services/orphaned-dispatch.mjs';

describe('classifyOrphanedDispatch', () => {
  it('is not orphaned while the worktree still says Lane Status: running', () => {
    assert.deepEqual(classifyOrphanedDispatch({ laneStatus: 'running' }), { orphaned: false });
    assert.deepEqual(classifyOrphanedDispatch({ laneStatus: 'Running' }), { orphaned: false });
  });

  it('is not orphaned when there is no Lane Status marker at all (nothing to go on yet)', () => {
    assert.deepEqual(classifyOrphanedDispatch({ laneStatus: null }), { orphaned: false });
    assert.deepEqual(classifyOrphanedDispatch({ laneStatus: undefined }), { orphaned: false });
    assert.deepEqual(classifyOrphanedDispatch({ laneStatus: '' }), { orphaned: false });
  });

  it('classifies a literal "failure" status as orphaned:failed, unambiguously', () => {
    const r = classifyOrphanedDispatch({ laneStatus: 'failure' });
    assert.equal(r.orphaned, true);
    assert.equal(r.status, 'failed');
  });

  it('classifies "success" as orphaned:done', () => {
    const r = classifyOrphanedDispatch({ laneStatus: 'success' });
    assert.equal(r.orphaned, true);
    assert.equal(r.status, 'done');
  });

  it('classifies "queue" as orphaned:done — the same success/not-yet-retried ambiguity reconcileActiveDispatch already lives with', () => {
    const r = classifyOrphanedDispatch({ laneStatus: 'queue' });
    assert.equal(r.orphaned, true);
    assert.equal(r.status, 'done');
    assert.match(r.result, /lane status: queue/);
  });

  it('does not treat a stale EARLIER lane\'s success as this dispatch\'s own outcome — track 10014\'s own incident', () => {
    // Reproduces this repo's own track-10014 incident live: a dispatch for
    // the "implement" action got orphaned by a worker restart before
    // implement had made any recorded progress at all — the worktree's
    // index.md still only had the PRIOR "plan" phase's own
    // Lane: plan / Lane Status: success markers on it, because implement
    // never got far enough to overwrite them. The old laneStatus-only
    // check had no way to know "success" belonged to plan, not implement,
    // and classified it orphaned:done — the caller then copied that stale
    // plan-phase index.md over the primary's own (already-further-along
    // implement:queue) copy and synced it to the DB, silently regressing
    // the track's Kanban lane backward from implement to plan. Passing the
    // worktree's own lane alongside the dispatch's action lets this be
    // caught: a lane that doesn't match the dispatched action means that
    // action's own run never actually started writing anything.
    const r = classifyOrphanedDispatch({ laneStatus: 'success', lane: 'plan', action: 'implement' });
    assert.equal(r.orphaned, true);
    assert.equal(r.status, 'failed');
    assert.equal(r.skipArtifactCopy, true, 'must not let the caller copy/sync the stale earlier-lane snapshot over a more-advanced primary state');
    assert.match(r.result, /implement/);
    assert.match(r.result, /plan/);
  });

  it('still trusts the worktree\'s status when lane and action agree', () => {
    const r = classifyOrphanedDispatch({ laneStatus: 'success', lane: 'implement', action: 'implement' });
    assert.equal(r.orphaned, true);
    assert.equal(r.status, 'done');
    assert.ok(!r.skipArtifactCopy);
  });

  it('is lane/action-check-agnostic (falls back to today\'s behavior) when lane or action is not supplied', () => {
    const r = classifyOrphanedDispatch({ laneStatus: 'success' });
    assert.equal(r.orphaned, true);
    assert.equal(r.status, 'done');
    assert.ok(!r.skipArtifactCopy);
  });
});
