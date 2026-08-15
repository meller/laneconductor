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
});
