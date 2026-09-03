// conductor/tests/track-10055-waiting-any-lane.test.mjs
//
// Track 10055: `<lane>:waiting` means "this lane action paused and needs a
// human" on EVERY lane, not just `done`. These cover the pure pieces of that
// contract — the `**Waiting Reason**` marker, the reason-resolution fallback,
// the worktree→primary marker merge, and the auto-complete classification.
//
// The exit-handler wiring itself (an agent writing `**Lane Status**: waiting`
// on `implement` and the track parking there rather than advancing to
// `review:queue`) is covered in track-10055-waiting-resume.test.mjs, which
// spawns a real worker.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseWaitingReason,
  writeWaitingReason,
  clearWaitingReason,
  resolveWaitingReason,
  WAITING_REASON_FALLBACK,
} from '../services/waiting-state.mjs';
import { mergeIndexMarkers } from '../services/worktree-artifact-merge.mjs';
import { classifyAutoCompleteOutcome } from '../services/auto-complete.mjs';
import { LaneActionStatus } from '../constants.mjs';

const INDEX_PARKED = `# Track 10055: Something

**Lane**: implement
**Lane Status**: waiting
**Progress**: 40%
**Waiting Reason**: Needs approval to run the destructive 0042 migration on prod
**Summary**: whatever
`;

const INDEX_PLAIN = `# Track 10055: Something

**Lane**: implement
**Lane Status**: queue
**Progress**: 40%
**Summary**: whatever
`;

describe('Phase 1 — the `**Waiting Reason**` marker', () => {
  test('TC-6a: parses the reason out of a parked index.md', () => {
    assert.equal(
      parseWaitingReason(INDEX_PARKED),
      'Needs approval to run the destructive 0042 migration on prod'
    );
  });

  test('TC-6b: returns null when the marker is absent', () => {
    assert.equal(parseWaitingReason(INDEX_PLAIN), null);
  });

  test('TC-6c: an empty marker value is null, not an empty string', () => {
    assert.equal(parseWaitingReason('**Waiting Reason**:   \n'), null);
  });

  test('TC-6d: writeWaitingReason updates an existing marker in place', () => {
    const out = writeWaitingReason(INDEX_PARKED, 'Different reason');
    assert.equal(parseWaitingReason(out), 'Different reason');
    assert.equal((out.match(/\*\*Waiting Reason\*\*/g) || []).length, 1);
  });

  test('TC-6e: writeWaitingReason appends the marker when absent', () => {
    const out = writeWaitingReason(INDEX_PLAIN, 'Needs a human');
    assert.equal(parseWaitingReason(out), 'Needs a human');
    // Must not disturb the other markers.
    assert.match(out, /\*\*Lane Status\*\*: queue/);
    assert.match(out, /\*\*Progress\*\*: 40%/);
  });

  test('TC-6f: a multi-line reason is flattened to one line (the marker is one line)', () => {
    const out = writeWaitingReason(INDEX_PLAIN, 'line one\nline two');
    assert.equal(parseWaitingReason(out), 'line one line two');
  });

  test('TC-17a: clearWaitingReason removes the marker entirely', () => {
    const out = clearWaitingReason(INDEX_PARKED);
    assert.equal(parseWaitingReason(out), null);
    assert.doesNotMatch(out, /Waiting Reason/);
    // Everything else survives.
    assert.match(out, /\*\*Progress\*\*: 40%/);
    assert.match(out, /\*\*Summary\*\*: whatever/);
  });

  test('TC-17b: clearWaitingReason on a file without the marker is a no-op', () => {
    assert.equal(clearWaitingReason(INDEX_PLAIN), INDEX_PLAIN);
  });
});

describe('Phase 2 — resolveWaitingReason (REQ-3: a park is never reasonless)', () => {
  test('TC-15a: the agent-written marker wins', () => {
    const r = resolveWaitingReason({
      markerReason: 'Needs prod DB approval',
      blockedQuestion: 'Should I apply the migration?',
    });
    assert.equal(r.reason, 'Needs prod DB approval');
    assert.equal(r.synthesized, false);
  });

  test('TC-15b: falls back to the blocked question when no marker was written', () => {
    const r = resolveWaitingReason({
      markerReason: null,
      blockedQuestion: 'Should I apply the migration?\nIt drops a column.',
    });
    assert.equal(r.reason, 'Should I apply the migration?');
    assert.equal(r.synthesized, true);
  });

  test('TC-15c: falls back to a generic reason when there is nothing at all, and says so', () => {
    const r = resolveWaitingReason({ markerReason: null, blockedQuestion: null });
    assert.equal(r.reason, WAITING_REASON_FALLBACK);
    assert.equal(r.synthesized, true);
    assert.ok(r.reason.length > 0, 'a park must never surface with an empty reason');
  });

  test('TC-15d: a whitespace-only marker is treated as absent, not as a reason', () => {
    const r = resolveWaitingReason({ markerReason: '   ', blockedQuestion: 'Real question?' });
    assert.equal(r.reason, 'Real question?');
    assert.equal(r.synthesized, true);
  });
});

describe('Phase 1 — worktree→primary marker merge (Task 1.6)', () => {
  test('TC-8a: **Waiting Reason** is injected into a primary index.md that lacks it', () => {
    const merged = mergeIndexMarkers(INDEX_PLAIN, INDEX_PARKED);
    assert.equal(
      parseWaitingReason(merged),
      'Needs approval to run the destructive 0042 migration on prod',
      'first-ever park must reach primary — same alwaysInject reasoning as **Waiting for reply**'
    );
  });

  test('TC-8b: an existing **Waiting Reason** on primary is updated in place', () => {
    const primary = writeWaitingReason(INDEX_PLAIN, 'Stale reason');
    const merged = mergeIndexMarkers(primary, INDEX_PARKED);
    assert.equal(
      parseWaitingReason(merged),
      'Needs approval to run the destructive 0042 migration on prod'
    );
    assert.equal((merged.match(/\*\*Waiting Reason\*\*/g) || []).length, 1);
  });

  test('TC-8c: `waiting` still survives skipStatusMarkers (the mid-run sync pass)', () => {
    // Pinned because the whole point of the status is that a human sees it
    // promptly — hiding it behind a stale "queue" until the run ends is the
    // track-10053 symptom this exemption exists for.
    const merged = mergeIndexMarkers(INDEX_PLAIN, INDEX_PARKED, { skipStatusMarkers: true });
    assert.match(merged, /\*\*Lane Status\*\*: waiting/);
  });

  test('TC-8d: a terminal `success` is still skipped during a mid-run sync', () => {
    const finished = INDEX_PARKED.replace('**Lane Status**: waiting', '**Lane Status**: success');
    const merged = mergeIndexMarkers(INDEX_PLAIN, finished, { skipStatusMarkers: true });
    assert.match(merged, /\*\*Lane Status\*\*: queue/, 'track-10019 hazard must still be guarded');
  });
});

describe('Phase 5 — auto-complete classifies a pause as a pause (REQ-11)', () => {
  test('TC-36: a non-done lane parking at waiting is a pause, not a failure to advance', () => {
    const r = classifyAutoCompleteOutcome({
      beforeLane: 'implement',
      afterLane: 'implement',
      afterStatus: 'waiting',
      waitingReason: 'Needs prod DB approval',
    });
    assert.equal(r.action, 'pause');
    assert.match(r.reason, /Needs prod DB approval/);
    assert.doesNotMatch(
      r.reason,
      /did not advance|rather than retrying/,
      'a deliberate pause must not be described as a stall'
    );
  });

  test('TC-36b: plan/review/quality-gate behave identically', () => {
    for (const lane of ['plan', 'review', 'quality-gate']) {
      const r = classifyAutoCompleteOutcome({ beforeLane: lane, afterLane: lane, afterStatus: 'waiting' });
      assert.equal(r.action, 'pause', `${lane} should pause`);
    }
  });

  test('TC-36c: a pause with no reason still explains itself', () => {
    const r = classifyAutoCompleteOutcome({ beforeLane: 'implement', afterLane: 'implement', afterStatus: 'waiting' });
    assert.equal(r.action, 'pause');
    assert.ok(r.reason && r.reason.trim().length > 0);
  });

  test('TC-37: done:waiting keeps its existing "PR opened" completion (track 1114 regression)', () => {
    const r = classifyAutoCompleteOutcome({ beforeLane: 'done', afterLane: 'done', afterStatus: 'waiting' });
    assert.equal(r.action, 'complete');
    assert.match(r.reason, /PR opened/);
  });

  test('TC-37b: every other classifyAutoCompleteOutcome branch is unchanged', () => {
    assert.equal(classifyAutoCompleteOutcome({ beforeLane: 'implement', afterLane: 'implement', afterStatus: 'running' }).action, 'wait');
    assert.equal(classifyAutoCompleteOutcome({ beforeLane: 'quality-gate', afterLane: 'done', afterStatus: 'queue' }).action, 'advance');
    assert.equal(classifyAutoCompleteOutcome({ beforeLane: 'done', afterLane: 'done', afterStatus: 'success' }).action, 'complete');
    assert.equal(classifyAutoCompleteOutcome({ beforeLane: 'done', afterLane: 'done', afterStatus: 'queue' }).action, 'stop');
    assert.equal(classifyAutoCompleteOutcome({ beforeLane: 'implement', afterLane: 'implement', afterStatus: 'failure' }).action, 'stop');
    assert.equal(classifyAutoCompleteOutcome({ beforeLane: 'implement', afterLane: 'review', afterStatus: 'queue' }).action, 'advance');
  });
});

describe('Phase 1 — the status set is sourced from one place', () => {
  test('TC-3b: `waiting` is a canonical LaneActionStatus value', () => {
    assert.equal(LaneActionStatus.WAITING, 'waiting');
    assert.ok(Object.values(LaneActionStatus).includes('waiting'));
  });
});
