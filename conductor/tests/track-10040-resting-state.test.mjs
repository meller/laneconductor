// Track 10040 Phase 4 (REQ-16, REQ-17, Finding 7): invalid resting states.
// Confirmed live: 10038 (implement:success, already merged), 1100
// (quality-gate:success), 10039 (implement:success) were all stranded —
// polled by nothing, escalated by nothing, looking healthy because
// 'success' reads as good news.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  deriveValidRestingStates,
  findInvalidRestingStates,
  classifyRestingState,
  classifyMergedButNotDone,
} from '../services/resting-state.mjs';

const REAL_WORKFLOW = JSON.parse(readFileSync('conductor/workflow.json', 'utf8'));

test('TC-96 (AC-16, no-false-positive half): this project\'s real workflow.json — plan:success is valid', () => {
  const validSet = deriveValidRestingStates(REAL_WORKFLOW);
  assert.ok(validSet.has('plan:success'), 'plan.on_success is literally "plan:success" — must not be flagged');
});

test('TC-97 (AC-16): a workflow with plan.on_success -> implement:queue makes plan:success invalid', () => {
  const workflow = {
    lanes: {
      plan: { on_success: 'implement:queue' },
      implement: { on_success: 'review:queue' },
    },
  };
  const validSet = deriveValidRestingStates(workflow);
  assert.equal(validSet.has('plan:success'), false, 'the set is derived, never hardcoded — this config must NOT get the real project\'s free pass');
});

test('TC-98 (AC-16): findInvalidRestingStates over a seeded fixture matching 10038/1100\'s shapes', () => {
  const validSet = deriveValidRestingStates(REAL_WORKFLOW);
  const tracks = [
    { trackNumber: '10038', lane: 'implement', status: 'success' },
    { trackNumber: '1100', lane: 'quality-gate', status: 'success' },
    { trackNumber: '10040', lane: 'plan', status: 'success' }, // must NOT be flagged
  ];
  const offenders = findInvalidRestingStates(tracks, validSet, REAL_WORKFLOW);

  const byTrack = Object.fromEntries(offenders.map(o => [o.trackNumber, o]));
  assert.ok(byTrack['10038']);
  assert.equal(byTrack['10038'].expectedTransition, 'review:queue');
  assert.ok(byTrack['1100']);
  assert.equal(byTrack['1100'].expectedTransition, 'done:queue');
  assert.equal(byTrack['10040'], undefined, 'plan:success must not be flagged for this project');
  assert.equal(offenders.length, 2);
});

test('TC-99: done:success, done:waiting, and every */queue,running,failure are never flagged', () => {
  const validSet = deriveValidRestingStates(REAL_WORKFLOW);
  const neverFlagged = [
    { lane: 'done', status: 'success' },
    { lane: 'done', status: 'waiting' },
    { lane: 'plan', status: 'queue' },
    { lane: 'implement', status: 'running' },
    { lane: 'review', status: 'failure' },
    { lane: 'quality-gate', status: 'queue' },
  ];
  const offenders = findInvalidRestingStates(
    neverFlagged.map((t, i) => ({ trackNumber: String(i), ...t })),
    validSet,
    REAL_WORKFLOW
  );
  assert.equal(offenders.length, 0);
});

test('TC-100: classifyRestingState with absent/inconsistent completion markers -> escalate (conservative default)', () => {
  assert.equal(classifyRestingState().action, 'escalate');
  assert.equal(classifyRestingState({ completionMarkersPresent: true, completionMarkersConsistent: false }).action, 'escalate');
  assert.equal(classifyRestingState({ completionMarkersPresent: false, completionMarkersConsistent: true }).action, 'escalate');
});

test('TC-101: classifyRestingState with complete, consistent markers -> reapply', () => {
  const r = classifyRestingState({ completionMarkersPresent: true, completionMarkersConsistent: true });
  assert.equal(r.action, 'reapply');
});

test('TC-102 (AC-17): classifyMergedButNotDone with mergeCommitReachable + lane implement -> invalid (10038\'s exact shape)', () => {
  const r = classifyMergedButNotDone({ trackNumber: '10038', mergeCommitReachable: true, lane: 'implement' });
  assert.equal(r.invalid, true);
  assert.equal(r.action, 'escalate');
});

test('TC-103 (AC-17, D9): the classification is always escalate — no code path returns reapply/auto-forward', () => {
  const lanes = ['backlog', 'plan', 'implement', 'review', 'quality-gate'];
  for (const lane of lanes) {
    const r = classifyMergedButNotDone({ trackNumber: 'x', mergeCommitReachable: true, lane });
    assert.ok(r.action === 'escalate' || r.action === null, `action must be escalate or null, got ${r.action}`);
    assert.notEqual(r.action, 'reapply');
  }
  // Merged AND already at done -> not invalid at all (nothing to escalate).
  const atDone = classifyMergedButNotDone({ trackNumber: 'x', mergeCommitReachable: true, lane: 'done' });
  assert.equal(atDone.invalid, false);
  // Not merged -> never invalid regardless of lane.
  const notMerged = classifyMergedButNotDone({ trackNumber: 'x', mergeCommitReachable: false, lane: 'plan' });
  assert.equal(notMerged.invalid, false);
});
