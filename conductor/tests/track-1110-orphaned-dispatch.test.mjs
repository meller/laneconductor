import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyOrphanedDispatch } from '../services/orphaned-dispatch.mjs';
import { copyWorktreeArtifactsToPrimary } from '../services/worktree-artifact-merge.mjs';

// Same shape as this repo's own conductor/workflow.json (Track 1117 tests
// use a fixture rather than reading the real file so they don't drift if
// the project's own workflow.json changes).
const WORKFLOW_FIXTURE = {
  lanes: {
    plan: { on_success: 'plan:success', on_failure: 'backlog' },
    implement: { on_success: 'review:queue', on_failure: 'implement:failure' },
    review: { on_success: 'quality-gate:queue', on_failure: 'implement:queue' },
    'quality-gate': { on_success: 'done:success', on_failure: 'plan:queue' },
  },
};

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

  // Track 1117 Bug 2 (REQ-4/5): a worktree lane that has legitimately
  // ADVANCED past the dispatched action, via a known workflow.json
  // on_success/on_failure transition, is the normal shape of a clean run —
  // it must not be treated the same as a genuine inconsistency.
  describe('forward-transition-aware mismatch guard (Track 1117 Bug 2)', () => {
    it('TC-4: worktree lane matching the on_success target is trusted and copied (no skip)', () => {
      // implement's on_success is "review:queue" — dispatched implement,
      // worktree now shows lane "review" (this is exactly track 1116's own
      // incident shape).
      const r = classifyOrphanedDispatch({
        laneStatus: 'success', lane: 'review', action: 'implement', workflowConfig: WORKFLOW_FIXTURE,
      });
      assert.equal(r.orphaned, true);
      assert.equal(r.status, 'done');
      assert.ok(!r.skipArtifactCopy, 'a legitimate on_success advance must not be skipped');
      assert.ok(!r.flagForHuman);
    });

    it('TC-5: worktree lane matching the on_failure target is also trusted and copied', () => {
      // review's on_failure is "implement:queue" — dispatched review,
      // worktree now shows lane "implement".
      const r = classifyOrphanedDispatch({
        laneStatus: 'failure', lane: 'implement', action: 'review', workflowConfig: WORKFLOW_FIXTURE,
      });
      assert.equal(r.orphaned, true);
      assert.equal(r.status, 'failed');
      assert.ok(!r.skipArtifactCopy, 'a legitimate on_failure advance must not be skipped');
      assert.ok(!r.flagForHuman);
    });

    it('TC-6: worktree lane matching NEITHER on_success nor on_failure is still skipped, and now flagged', () => {
      // dispatched implement (on_success: review, on_failure: implement) —
      // worktree shows "done", which is neither.
      const r = classifyOrphanedDispatch({
        laneStatus: 'success', lane: 'done', action: 'implement', workflowConfig: WORKFLOW_FIXTURE,
      });
      assert.equal(r.orphaned, true);
      assert.equal(r.status, 'failed');
      assert.equal(r.skipArtifactCopy, true, 'a genuinely unrecognized mismatch must still be skipped');
      assert.equal(r.flagForHuman, true, 'a genuine mismatch must now be flagged for human review, not just console-warned');
    });

    it('TC-7 (regression): reproduces track 1116\'s exact incident end-to-end — implement dispatch, worktree advances to review, primary checkout auto-updates', () => {
      const root = mkdtempSync(join(tmpdir(), 'lc-track1117-tc7-'));
      try {
        const worktreePath = join(root, 'worktree');
        const primaryRoot = join(root, 'primary');
        const wtTrackDir = join(worktreePath, 'conductor', 'tracks', '1116-test-track');
        const primaryTrackDir = join(primaryRoot, 'conductor', 'tracks', '1116-test-track');
        mkdirSync(wtTrackDir, { recursive: true });
        mkdirSync(primaryTrackDir, { recursive: true });

        // Primary checkout is stuck exactly as track 1116's was: still shows
        // implement/running (Bug 1's incorrect stuck_timeout mark), 0%.
        writeFileSync(join(primaryTrackDir, 'index.md'),
          '# Track 1116\n\n**Lane**: implement\n**Lane Status**: running\n**Progress**: 0%\n');

        // Worktree has ALREADY correctly finished and advanced to review —
        // this is the real, newer state that Bug 2 used to strand.
        writeFileSync(join(wtTrackDir, 'index.md'),
          '# Track 1116\n\n**Lane**: review\n**Lane Status**: success\n**Progress**: 100%\n');

        const resolveTrackFolder = (tracksDir) => '1116-test-track';

        const classification = classifyOrphanedDispatch({
          laneStatus: 'success', lane: 'review', action: 'implement', workflowConfig: WORKFLOW_FIXTURE,
        });
        assert.ok(!classification.skipArtifactCopy, 'a real on_success advance must not be skipped');

        const { copied } = copyWorktreeArtifactsToPrimary({
          worktreePath, trackNumber: '1116', isSuccess: classification.status === 'done', primaryRoot, resolveTrackFolder,
        });
        assert.ok(copied.includes('index.md'));

        const finalPrimary = readFileSync(join(primaryTrackDir, 'index.md'), 'utf8');
        assert.match(finalPrimary, /\*\*Lane\*\*:\s*review/, 'primary checkout must auto-update to the worktree\'s advanced lane — no manual reconciliation needed');
        assert.match(finalPrimary, /\*\*Progress\*\*:\s*100%/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
