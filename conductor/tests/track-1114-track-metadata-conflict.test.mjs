#!/usr/bin/env node
// conductor/tests/track-1114-track-metadata-conflict.test.mjs
// Track 1114 Phase 17: isTrackBookkeepingConflict() — the decision that
// lets mergeWorktreeBranch()/auditWorktrees() treat a conflict limited to a
// track's own conductor/tracks/<N>-*/ status files as auto-resolvable,
// instead of permanently blocking the merge as 'conflicted'.
//
// Run: node --test conductor/tests/track-1114-track-metadata-conflict.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTrackBookkeepingConflict } from '../services/track-metadata-conflict.mjs';

describe('isTrackBookkeepingConflict()', () => {
  it('is true when every conflicting path is a known bookkeeping file under the track\'s own directory', () => {
    assert.equal(isTrackBookkeepingConflict(['conductor/tracks/10014-project-management-page/index.md'], '10014'), true);
    assert.equal(isTrackBookkeepingConflict([
      'conductor/tracks/10014-project-management-page/index.md',
      'conductor/tracks/10014-project-management-page/plan.md',
    ], '10014'), true);
  });

  it('is true for the current INITIALS-NNN-slug folder convention, not just the legacy NNN-slug one (track 10038)', () => {
    assert.equal(isTrackBookkeepingConflict(['conductor/tracks/AM-10038-widen-bookkeeping-conflict-autoresolve/index.md'], '10038'), true);
    assert.equal(isTrackBookkeepingConflict([
      'conductor/tracks/AM-10038-widen-bookkeeping-conflict-autoresolve/index.md',
      'conductor/tracks/AM-10038-widen-bookkeeping-conflict-autoresolve/plan.md',
    ], '10038'), true);
    // A prefixed OTHER track's folder must still not match this track's number.
    assert.equal(isTrackBookkeepingConflict(['conductor/tracks/AM-10039-other/index.md'], '10038'), false);
  });

  it('is false when any conflicting path is real code, even alongside bookkeeping conflicts', () => {
    assert.equal(isTrackBookkeepingConflict([
      'conductor/tracks/10014-project-management-page/index.md',
      'ui/server/index.mjs',
    ], '10014'), false);
  });

  it('is false when the conflicting file belongs to a DIFFERENT track\'s directory', () => {
    assert.equal(isTrackBookkeepingConflict(['conductor/tracks/9999-other-track/index.md'], '10014'), false);
  });

  it('is false for a file directly under conductor/tracks/ with no track subdirectory', () => {
    assert.equal(isTrackBookkeepingConflict(['conductor/tracks/file_sync_queue.md'], '10014'), false);
  });

  it('is false for an unrecognized filename inside the track\'s own directory (whitelist, not a bare prefix check)', () => {
    assert.equal(isTrackBookkeepingConflict(['conductor/tracks/10014-project-management-page/scratch.js'], '10014'), false);
  });

  it('is false for an empty or missing conflict list — nothing to resolve', () => {
    assert.equal(isTrackBookkeepingConflict([], '10014'), false);
    assert.equal(isTrackBookkeepingConflict(undefined, '10014'), false);
  });
});
