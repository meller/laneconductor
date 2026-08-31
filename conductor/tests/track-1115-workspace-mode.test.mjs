#!/usr/bin/env node
// conductor/tests/track-1115-workspace-mode.test.mjs
// Track 1115 Phase 2: pure unit tests for resolveWorkspaceMode()/parseWorkspaceMarker().
// Each case maps to a row (or a precedence conflict between rows) of
// spec.md's D5 table. TC-3/TC-4 are the load-bearing pair: they pin the
// exact ordering that encodes D1's refinement (explicit marker beats
// auto-queue; type-derived default does not).
//
// Run: node --test conductor/tests/track-1115-workspace-mode.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorkspaceMode, parseWorkspaceMarker, parseTrackKind, findDisqualifyingDirtyPaths, isWorkerBookkeepingPath } from '../services/workspace-mode.mjs';

describe('resolveWorkspaceMode', () => {
  it('TC-1: plan lane outranks an explicit branch marker (D6 before D2)', () => {
    assert.equal(
      resolveWorkspaceMode({ laneStatus: 'plan', workspaceMarker: 'branch' }),
      'main'
    );
  });

  it('TC-2: plan lane outranks the auto-queue trigger too', () => {
    assert.equal(
      resolveWorkspaceMode({ laneStatus: 'plan', trigger: 'auto-queue' }),
      'main'
    );
  });

  it('TC-2b (track 10035): done lane outranks an explicit branch marker, same as plan', () => {
    assert.equal(
      resolveWorkspaceMode({ laneStatus: 'done', workspaceMarker: 'branch' }),
      'main'
    );
  });

  it('TC-2c (track 10035): done lane outranks the auto-queue trigger too', () => {
    assert.equal(
      resolveWorkspaceMode({ laneStatus: 'done', trigger: 'auto-queue' }),
      'main'
    );
  });

  it('TC-3: explicit main marker WINS over auto-queue (D1 refinement)', () => {
    assert.equal(
      resolveWorkspaceMode({
        laneStatus: 'implement',
        workspaceMarker: 'main',
        trigger: 'auto-queue',
      }),
      'main'
    );
  });

  it('TC-4: type-derived bug default does NOT survive auto-queue', () => {
    assert.equal(
      resolveWorkspaceMode({
        laneStatus: 'implement',
        workspaceMarker: null,
        trackType: 'bug',
        trigger: 'auto-queue',
      }),
      'branch'
    );
  });

  it('TC-5: bug type defaults to main for a manually-dispatched run', () => {
    assert.equal(
      resolveWorkspaceMode({
        laneStatus: 'implement',
        trackType: 'bug',
        trigger: 'manual-dispatch',
      }),
      'main'
    );
  });

  it('TC-6: auto-complete is treated as unattended, same as auto-queue', () => {
    assert.equal(
      resolveWorkspaceMode({
        laneStatus: 'implement',
        trackType: 'bug',
        trigger: 'auto-complete',
      }),
      'branch'
    );
  });

  it('TC-7: explicit marker overrides the type default', () => {
    assert.equal(
      resolveWorkspaceMode({
        laneStatus: 'implement',
        workspaceMarker: 'branch',
        trackType: 'bug',
        trigger: 'manual-dispatch',
      }),
      'branch'
    );
  });

  it('TC-8: project default applies when nothing above hits', () => {
    assert.equal(
      resolveWorkspaceMode({
        laneStatus: 'implement',
        trackType: 'feature',
        trigger: 'manual-dispatch',
        projectWorkspaceMode: 'main',
      }),
      'main'
    );
  });

  it('TC-9: falls back to branch when nothing is set (today\'s behavior)', () => {
    assert.equal(
      resolveWorkspaceMode({ laneStatus: 'implement', trigger: 'manual-dispatch' }),
      'branch'
    );
  });

  it('TC-10: invalid marker values are ignored, not coerced to main', () => {
    assert.equal(parseWorkspaceMarker('**Workspace**: MAIN'), 'main'); // case-insensitive is valid
    assert.equal(parseWorkspaceMarker('**Workspace**: garbage'), null);
    assert.equal(parseWorkspaceMarker('**Workspace**: '), null);
  });

  it('TC-11: no **Workspace** line parses to null, not a default', () => {
    assert.equal(parseWorkspaceMarker('# Track 1: Title\n\n**Lane**: plan\n'), null);
  });

  // TC-30's second half (corrected during implementation — see spec.md D3):
  // **Track Kind** is a distinct, narrow marker from **Type**/**Workspace**,
  // used ONLY to feed D5 row 4 without collapsing the type-derived default
  // into an explicit override.
  it('parseTrackKind: reads **Track Kind**: bug, ignores garbage, absent -> null', () => {
    assert.equal(parseTrackKind('**Track Kind**: bug\n'), 'bug');
    assert.equal(parseTrackKind('**Track Kind**: feature\n'), 'feature');
    assert.equal(parseTrackKind('**Track Kind**: garbage\n'), null);
    assert.equal(parseTrackKind('# Track 1\n**Lane**: plan\n'), null);
  });

  it('TC-30 regression: an end-to-end bug track (via Track Kind, no explicit marker) still gets branch on auto-queue', () => {
    const trackKindContent = '# Track 1: fix a thing\n\n**Track Kind**: bug\n**Lane**: implement\n';
    assert.equal(
      resolveWorkspaceMode({
        laneStatus: 'implement',
        workspaceMarker: parseWorkspaceMarker(trackKindContent),
        trackType: parseTrackKind(trackKindContent),
        trigger: 'auto-queue',
      }),
      'branch'
    );
  });
});

describe('findDisqualifyingDirtyPaths (dogfooding 2026-08-25 regression)', () => {
  it('exempts another track\'s own routinely-resynced status markers (index/plan/spec/test.md)', () => {
    const dirty = [
      'conductor/tracks/1091-manager-worker-and-new-project-flow/index.md',
      'conductor/tracks/1091-manager-worker-and-new-project-flow/plan.md',
      'conductor/tracks/1102-e2e-session-findings/spec.md',
      'conductor/tracks/1102-e2e-session-findings/test.md',
    ];
    assert.deepEqual(findDisqualifyingDirtyPaths(dirty, 'conductor/tracks/1118-manager-worker-credential-storage/'), []);
  });

  it('does NOT exempt another track\'s conversation.md — a human can genuinely have unsaved work there', () => {
    const dirty = ['conductor/tracks/1091-manager-worker-and-new-project-flow/conversation.md'];
    assert.deepEqual(findDisqualifyingDirtyPaths(dirty, 'conductor/tracks/1118-manager-worker-credential-storage/'), dirty);
  });

  it('does NOT exempt a file that merely lives inside a track folder but isn\'t one of the four known names', () => {
    const dirty = ['conductor/tracks/1091-manager-worker-and-new-project-flow/some-script.mjs'];
    assert.deepEqual(findDisqualifyingDirtyPaths(dirty, 'conductor/tracks/1118-manager-worker-credential-storage/'), dirty);
  });

  it('still exempts the track\'s own folder, worker bookkeeping, and file_sync_queue.md (pre-existing behavior unchanged)', () => {
    const dirty = [
      'conductor/tracks/1118-manager-worker-credential-storage/index.md', // own folder
      'conductor/.sync.pid',
      'conductor/tracks-metadata.json',
      'conductor/tracks/file_sync_queue.md',
    ];
    assert.deepEqual(findDisqualifyingDirtyPaths(dirty, 'conductor/tracks/1118-manager-worker-credential-storage/'), []);
  });

  it('a genuinely unrelated dirty file (outside conductor/tracks entirely) still disqualifies', () => {
    const dirty = ['ui/src/App.jsx', 'conductor/tracks/1091-foo/index.md'];
    assert.deepEqual(findDisqualifyingDirtyPaths(dirty, null), ['ui/src/App.jsx']);
  });

  it('isWorkerBookkeepingPath: direct assertions on the four exempt shapes plus one non-match', () => {
    assert.equal(isWorkerBookkeepingPath('conductor/.sync-2.lock-target'), true);
    assert.equal(isWorkerBookkeepingPath('conductor/tracks-metadata.json'), true);
    assert.equal(isWorkerBookkeepingPath('conductor/tracks/file_sync_queue.md'), true);
    assert.equal(isWorkerBookkeepingPath('conductor/tracks/042-foo/plan.md'), true);
    assert.equal(isWorkerBookkeepingPath('conductor/tracks/042-foo/conversation.md'), false);
  });

  it('exempts .laneconductor.json (dogfooding 2026-08-30 regression, track AM-1121) — machine-rewritten by normal worker registration, not human WIP', () => {
    assert.equal(isWorkerBookkeepingPath('.laneconductor.json'), true);
    const dirty = ['.laneconductor.json', 'conductor/tracks/AM-1001-foo/conversation.md'];
    assert.deepEqual(
      findDisqualifyingDirtyPaths(dirty, 'conductor/tracks/AM-1000-bar/'),
      ['conductor/tracks/AM-1001-foo/conversation.md'],
      '.laneconductor.json must not disqualify a main-mode spawn; a sibling track\'s conversation.md still does'
    );
  });

  it('exempts a resolveTrackFolder quarantine artifact (dogfooding 2026-08-26 regression, track 1119)', () => {
    assert.equal(isWorkerBookkeepingPath('conductor/tracks/_duplicate-1119-stale-placeholder/'), true);
    assert.equal(isWorkerBookkeepingPath('conductor/tracks/_duplicate-1119-stale-placeholder/index.md'), true);
    const dirty = ['conductor/tracks/_duplicate-1119-stale-placeholder/'];
    assert.deepEqual(findDisqualifyingDirtyPaths(dirty, 'conductor/tracks/AM-1119-app-creator-wizard/'), []);
  });

  it('exempts another track\'s .conv-cursor and .conv-cursor.lock (dogfooding 2026-08-27 regression, track 10020)', () => {
    assert.equal(isWorkerBookkeepingPath('conductor/tracks/1052-show-hn/.conv-cursor'), true);
    assert.equal(isWorkerBookkeepingPath('conductor/tracks/1052-show-hn/.conv-cursor.lock'), true);
    const dirty = [
      'conductor/tracks/1052-show-hn/.conv-cursor',
      'conductor/tracks/999-canary/.conv-cursor.lock',
    ];
    assert.deepEqual(findDisqualifyingDirtyPaths(dirty, 'conductor/tracks/10020-bug-fixes-round-2/'), []);
  });
});
