// Track 1114 Phase 7: previously untested lane-write path for Force Merge
// (skip checks) — extracted from the merge-worktree dispatch handler in
// laneconductor.sync.mjs so it's testable without a real worktree, git
// process, or dispatch queue.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldWriteForceDoneMarker, applyDoneSuccessMarkers } from '../services/force-merge-marker.mjs';

describe('shouldWriteForceDoneMarker', () => {
  it('writes the marker when forcing a track that has not reached done:success and has a live worktree', () => {
    assert.equal(
      shouldWriteForceDoneMarker({ isDoneSuccess: false, force: true, hasWorktree: true, worktreePath: '/repo/.worktrees/1065' }),
      true,
    );
  });

  it('does not write when the track already reached done:success — nothing to force', () => {
    assert.equal(
      shouldWriteForceDoneMarker({ isDoneSuccess: true, force: true, hasWorktree: true, worktreePath: '/repo/.worktrees/1065' }),
      false,
    );
  });

  it('does not write when force is not set — plain "Merge to main" must never touch lane state', () => {
    assert.equal(
      shouldWriteForceDoneMarker({ isDoneSuccess: false, force: false, hasWorktree: true, worktreePath: '/repo/.worktrees/1065' }),
      false,
    );
  });

  it('does not write for a stranded row with no live worktree — falls back to plain git-only force merge', () => {
    assert.equal(
      shouldWriteForceDoneMarker({ isDoneSuccess: false, force: true, hasWorktree: false, worktreePath: null }),
      false,
    );
  });

  it('does not write when hasWorktree is true but worktreePath is missing — need a real path to write into', () => {
    assert.equal(
      shouldWriteForceDoneMarker({ isDoneSuccess: false, force: true, hasWorktree: true, worktreePath: null }),
      false,
    );
  });
});

describe('applyDoneSuccessMarkers', () => {
  it('replaces existing Lane and Lane Status markers in place', () => {
    const content = [
      '# Track 1065: Example',
      '',
      '**Lane**: review',
      '**Lane Status**: running',
      '**Progress**: 60%',
      '',
    ].join('\n');
    const updated = applyDoneSuccessMarkers(content);
    assert.match(updated, /\*\*Lane\*\*: done/);
    assert.match(updated, /\*\*Lane Status\*\*: success/);
    assert.match(updated, /\*\*Progress\*\*: 60%/, 'unrelated markers must be left untouched');
    assert.equal(updated.match(/\*\*Lane\*\*:/g).length, 1, 'must not duplicate the Lane marker');
  });

  it('does not let Lane Status collide with the Lane replace (prefix collision)', () => {
    const content = '**Lane**: implement\n**Lane Status**: running\n';
    const updated = applyDoneSuccessMarkers(content);
    assert.match(updated, /\*\*Lane\*\*: done\n/);
    assert.match(updated, /\*\*Lane Status\*\*: success/);
  });

  it('appends both markers when neither is present yet', () => {
    const content = '# Track 1065: Example\n\n**Progress**: 0%\n';
    const updated = applyDoneSuccessMarkers(content);
    assert.match(updated, /\*\*Lane\*\*: done/);
    assert.match(updated, /\*\*Lane Status\*\*: success/);
  });
});
