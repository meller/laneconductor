#!/usr/bin/env node
// conductor/tests/track-10076-done-lane-bucket.test.mjs
// Track 10076 Phase 1: the pure decision logic behind the done-lane
// display bucket. See done-lane-bucket.mjs's own doc comment for the
// central design constraint (classificationAvailable must gate every
// override — an unavailable classification is never evidence of "merged").
//
// Run: env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10076-done-lane-bucket.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDoneLaneBucket, UNMERGED_CLASSIFICATIONS } from '../services/done-lane-bucket.mjs';
import { planDoneLaneMigration } from '../services/done-lane-migration.mjs';

describe('resolveDoneLaneBucket', () => {
  it('TC-1.1: returns null for any lane other than done', () => {
    const result = resolveDoneLaneBucket({
      laneStatus: 'implement', laneActionStatus: 'running',
      worktreeClass: 'mergeable', classificationAvailable: true,
    });
    assert.equal(result, null);
  });

  it('TC-1.2: a done:success track with a live mergeable branch is overridden to Unmerged', () => {
    const result = resolveDoneLaneBucket({
      laneStatus: 'done', laneActionStatus: 'success',
      worktreeClass: 'mergeable', classificationAvailable: true,
    });
    assert.equal(result.source, 'git');
    assert.equal(result.bucket, 'unmerged');
    assert.match(result.label, /Unmerged/);
    assert.doesNotMatch(result.label, /Success/);
  });

  it('TC-1.3: a done:failure track classified conflicted gets the merge-failed label, distinct from never-attempted', () => {
    const result = resolveDoneLaneBucket({
      laneStatus: 'done', laneActionStatus: 'failure',
      worktreeClass: 'conflicted', classificationAvailable: true,
    });
    assert.equal(result.source, 'git');
    assert.equal(result.bucket, 'unmerged-failed');
    assert.match(result.label, /Unmerged — merge failed/);
  });

  it('TC-1.4: a done:waiting pr-open track renders as PR open, not Unmerged', () => {
    const result = resolveDoneLaneBucket({
      laneStatus: 'done', laneActionStatus: 'waiting',
      worktreeClass: 'pr-open', classificationAvailable: true,
    });
    assert.equal(result.source, 'git');
    assert.equal(result.bucket, 'pr-open');
    assert.match(result.label, /PR open/);
  });

  it('TC-1.5: a done:success track with a live worker reporting nothing to merge is genuinely Success', () => {
    const result = resolveDoneLaneBucket({
      laneStatus: 'done', laneActionStatus: 'success',
      worktreeClass: null, classificationAvailable: true,
    });
    assert.equal(result.bucket, 'success');
    assert.match(result.label, /Success/);
  });

  it('TC-1.6: the null trap — same Success label reached via the fallback path when unavailable, not the git path', () => {
    const result = resolveDoneLaneBucket({
      laneStatus: 'done', laneActionStatus: 'success',
      worktreeClass: null, classificationAvailable: false,
    });
    assert.equal(result.source, 'lane_action_status');
    assert.match(result.label, /Success/);
  });

  it('TC-1.7: done:queue with no classification signal falls back to today\'s Unmerged label', () => {
    const result = resolveDoneLaneBucket({
      laneStatus: 'done', laneActionStatus: 'queue',
      worktreeClass: null, classificationAvailable: false,
    });
    assert.equal(result.source, 'lane_action_status');
    assert.equal(result.bucket, 'queue');
    assert.match(result.label, /Unmerged/);
  });

  it('TC-1.8: done:failure with no classification signal keeps the ffeaf510 stopgap label', () => {
    const result = resolveDoneLaneBucket({
      laneStatus: 'done', laneActionStatus: 'failure',
      worktreeClass: null, classificationAvailable: false,
    });
    assert.equal(result.source, 'lane_action_status');
    assert.equal(result.bucket, 'failure');
    assert.match(result.label, /Unmerged — merge failed/);
  });

  it('TC-1.9: the null trap — a stale worktreeClass is never trusted once availability is false', () => {
    const result = resolveDoneLaneBucket({
      laneStatus: 'done', laneActionStatus: 'success',
      worktreeClass: 'mergeable', classificationAvailable: false,
    });
    assert.equal(result.source, 'lane_action_status');
    assert.match(result.label, /Success/);
  });

  it('TC-1.10: "open" and "detached" classifications are not done-lane-unmerged signals — falls through', () => {
    for (const worktreeClass of ['open', 'detached']) {
      const result = resolveDoneLaneBucket({
        laneStatus: 'done', laneActionStatus: 'queue',
        worktreeClass, classificationAvailable: true,
      });
      assert.equal(result.source, 'lane_action_status', `unexpected override for classification "${worktreeClass}"`);
    }
  });

  it('TC-1.11: UNMERGED_CLASSIFICATIONS is the exact set planDoneLaneMigration treats as unmerged', () => {
    for (const classification of UNMERGED_CLASSIFICATIONS) {
      const actions = planDoneLaneMigration([
        { trackNumber: '999', lane: 'done', laneStatus: 'success', classification, mergeMode: 'direct' },
      ]);
      assert.equal(actions.length, 1, `expected a requeue action for classification "${classification}"`);
      assert.equal(actions[0].type, 'requeue-done-success');
    }
    // 'open' is deliberately excluded from the set — a done:success/open
    // row is the superseded case, never requeued.
    assert.ok(!UNMERGED_CLASSIFICATIONS.includes('open'));
  });
});
