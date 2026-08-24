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
import { resolveWorkspaceMode, parseWorkspaceMarker, parseTrackKind } from '../services/workspace-mode.mjs';

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
