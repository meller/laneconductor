#!/usr/bin/env node
// conductor/tests/track-10035-migration.test.mjs
// Track 10035 Phase 5 Task 3 (REQ-11, TC-5.3): the pure migration-planning
// logic behind `lc worktrees migrate-done-lane`. No git/DB I/O here — see
// done-lane-migration.mjs's own doc comment for why the decision logic is
// factored out this way.
//
// Run: node --test conductor/tests/track-10035-migration.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planDoneLaneMigration } from '../services/done-lane-migration.mjs';

describe('planDoneLaneMigration', () => {
  it('(a) plans a requeue-done-success action for a done:success track with a live unmerged branch', () => {
    const rows = [
      { trackNumber: '101', lane: 'done', laneStatus: 'success', classification: 'mergeable', mergeMode: 'direct' },
    ];
    const actions = planDoneLaneMigration(rows);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'requeue-done-success');
    assert.equal(actions[0].trackNumber, '101');
  });

  it('(b) plans nothing for a done:success track that is genuinely, fully merged (never appears in rows at all)', () => {
    // auditWorktrees() itself omits fully-merged branches entirely (its own
    // isAncestor early-continue) — this fixture models that: the row
    // simply never shows up, so there's nothing to plan against.
    const rows = [];
    const actions = planDoneLaneMigration(rows);
    assert.deepEqual(actions, []);
  });

  it('(c) plans a correct-merge-mode action when the DB disagrees with the file marker — file wins', () => {
    const rows = [
      { trackNumber: '102', lane: 'done', laneStatus: 'queue', classification: 'mergeable', mergeMode: 'direct' },
    ];
    const actions = planDoneLaneMigration(rows, { '102': 'pr' });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'correct-merge-mode');
    assert.equal(actions[0].from, 'pr');
    assert.equal(actions[0].to, 'direct');
  });

  it('plans nothing when the DB merge_mode already agrees with the file', () => {
    const rows = [
      { trackNumber: '103', lane: 'done', laneStatus: 'queue', classification: 'mergeable', mergeMode: 'pr' },
    ];
    const actions = planDoneLaneMigration(rows, { '103': 'pr' });
    assert.deepEqual(actions, []);
  });

  it('plans nothing for a track missing from the DB map (e.g. local-fs mode, no DB at all)', () => {
    const rows = [
      { trackNumber: '104', lane: 'done', laneStatus: 'success', classification: 'open', mergeMode: 'pr' },
    ];
    const actions = planDoneLaneMigration(rows, {});
    assert.deepEqual(actions, []);
  });

  it('a done:success track classified "open" (not actually unmerged) is left alone', () => {
    // Shouldn't normally happen (isAncestor would have already dropped a
    // truly-merged branch before classification runs), but 'open' can
    // still occur for a superseded row — never treat it as needing requeue.
    const rows = [
      { trackNumber: '105', lane: 'done', laneStatus: 'success', classification: 'open', mergeMode: 'direct' },
    ];
    const actions = planDoneLaneMigration(rows);
    assert.deepEqual(actions, []);
  });

  it('a done:queue/waiting/failure track (already correct under the new model) gets no requeue action', () => {
    const rows = [
      { trackNumber: '106', lane: 'done', laneStatus: 'queue', classification: 'mergeable', mergeMode: 'direct' },
      { trackNumber: '107', lane: 'done', laneStatus: 'waiting', classification: 'pr-open', mergeMode: 'pr' },
      { trackNumber: '108', lane: 'done', laneStatus: 'failure', classification: 'conflicted', mergeMode: 'direct' },
    ];
    const actions = planDoneLaneMigration(rows);
    assert.deepEqual(actions.filter(a => a.type === 'requeue-done-success'), []);
  });

  it('re-running the sweep against the already-migrated state is a no-op', () => {
    // Post-migration: the row's own laneStatus is now 'queue' (the
    // requeue already happened) and the DB agrees with the file.
    const rows = [
      { trackNumber: '101', lane: 'done', laneStatus: 'queue', classification: 'mergeable', mergeMode: 'direct' },
      { trackNumber: '102', lane: 'done', laneStatus: 'queue', classification: 'mergeable', mergeMode: 'direct' },
    ];
    const actions = planDoneLaneMigration(rows, { '101': 'direct', '102': 'direct' });
    assert.deepEqual(actions, []);
  });

  it('skips rows with no track (detached worktrees) entirely', () => {
    const rows = [
      { trackNumber: null, lane: null, laneStatus: null, classification: 'detached', mergeMode: 'pr' },
    ];
    const actions = planDoneLaneMigration(rows, { null: 'direct' });
    assert.deepEqual(actions, []);
  });
});
