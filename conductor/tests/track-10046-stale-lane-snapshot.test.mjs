// Track AM-10046 Phase 1: reproduces the stale-lane-snapshot race before any
// fix lands, per spec.md's confirmed mechanism (W1 prompt, W2 cmd_type, W3
// exit handler) and the guard table's two uncovered quadrants.
//
// conductor/laneconductor.sync.mjs boots a whole worker on import (same
// constraint documented in track-10046-waiting-for-reply-conflation.test.mjs
// and track-10040-duplicate-dir-scan.test.mjs), so real-code coverage here
// is source-level pins (readFileSync + string/regex assertions against the
// literal writer sites) rather than direct calls into the exit handler.
// Pure-logic coverage is direct calls into the already-extracted guard
// (lane-regression-guard.mjs) and this track's new
// conversation-run-write-scope.mjs.
//
// TC-1 and TC-5 are deliberately NOT fixed by Phase 2 — see the comment on
// each for which later phase actually flips them green (Phase 5 and Phase 4
// respectively). Running this file against current main, only TC-3 and
// TC-2a should pass; everything else must fail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldBlockLaneWrite } from '../services/lane-regression-guard.mjs';
import { getConversationRunWriteScope, CONVERSATION_REPLY_ACTION } from '../services/conversation-run-write-scope.mjs';

const SYNC_SRC = readFileSync(new URL('../laneconductor.sync.mjs', import.meta.url), 'utf8');

// ── TC-1: forward clobber (guard table row 2) ──────────────────────────────
// A reply run's stale snapshot is 'implement'; while it was in flight,
// quality-gate's on_failure legitimately moved the track to 'plan'. The
// reply's intended write ('implement') is FORWARD of on-disk 'plan'
// (rank 2 > rank 1), and shouldBlockLaneWrite's rank check only guards the
// BACKWARD direction (`intendedRank < onDiskRank`) — a forward write is
// never blocked today, regardless of producedByThisRun. This is a general
// guard gap (REQ-9), not specific to conversation runs, so it is closed in
// Phase 5 (TC-11), not here. Kept here anyway to document the exact
// quadrant spec.md's guard table calls out as uncovered.
test('TC-1 (Phase 5 fixes this): forward write over a fresher on-disk lane, not produced by this run, should be blocked', () => {
  const r = shouldBlockLaneWrite({
    onDiskLane: 'plan',
    intendedLane: 'implement',
    producedByThisRun: false,
  });
  assert.equal(r.blocked, true, 'a forward write the current run did not produce must be blocked, same as the backward case already is');
});

// ── TC-2: exit handler must not touch Lane/Lane Status for a conversation run ──
// (guard table row 3 — same-lane **Lane Status** clobber). The real bug
// isn't in applyGuardedLaneWrite (a generic primitive doing what it's told)
// — it's that the exit handler calls it AT ALL for a conversation run. The
// fix (Phase 2, REQ-1/REQ-2) is to gate that call on
// getConversationRunWriteScope, never on the guard getting smarter about
// status. Source-pinned, same technique as TC-4/TC-5 below.
test('TC-2 (Phase 2 fixes this): exit handler must consult getConversationRunWriteScope before writing Lane/Lane Status', () => {
  assert.ok(
    SYNC_SRC.includes('getConversationRunWriteScope'),
    'laneconductor.sync.mjs must import and consult getConversationRunWriteScope before its Lane/Lane Status writes — otherwise a conversation run can still overwrite a concurrently-live **Lane Status** (e.g. "running") with its own stale-snapshot-derived value'
  );
});

// ── TC-2a: the write-scope module's own contract (passes immediately — this
// pins the NEW pure module itself, not the real dispatch code's use of it) ──
test('TC-2a: getConversationRunWriteScope denies Lane and Lane Status for every claimable lane when isConversationRun', () => {
  for (const lane of ['plan', 'implement', 'review', 'quality-gate', 'done']) {
    const scope = getConversationRunWriteScope({ isConversationRun: true });
    assert.equal(scope.canWriteLane, false, `lane=${lane}`);
    assert.equal(scope.canWriteLaneStatus, false, `lane=${lane}`);
  }
  const normalScope = getConversationRunWriteScope({ isConversationRun: false });
  assert.equal(normalScope.canWriteLane, true);
  assert.equal(normalScope.canWriteLaneStatus, true);
});

test('TC-2b: CONVERSATION_REPLY_ACTION is a non-lane sentinel', () => {
  const CLAIMABLE = ['plan', 'implement', 'review', 'quality-gate', 'done'];
  assert.ok(!CLAIMABLE.includes(CONVERSATION_REPLY_ACTION));
});

// ── TC-3: non-regression — the ALREADY-covered backwards quadrant ─────────
// (guard table row 1). Must stay blocked exactly as track 10040 left it.
test('TC-3 (non-regression, already correct): backward write not produced by this run stays blocked', () => {
  const r = shouldBlockLaneWrite({
    onDiskLane: 'implement',
    intendedLane: 'plan',
    producedByThisRun: false,
  });
  assert.equal(r.blocked, true);
});

// ── TC-4: W1 — the reply prompt must not interpolate the dispatch-time snapshot ──
test('TC-4 (Phase 2 fixes this): reply customPrompt must not instruct a pulse to the stale lane_status snapshot', () => {
  assert.ok(
    !SYNC_SRC.includes('/laneconductor pulse ${track_number} ${lane_status}'),
    'the waitingForReply customPrompt must not tell the agent to pulse ${lane_status} — that value is the dispatch-time snapshot, not necessarily still the on-disk lane by the time the reply finishes'
  );
});

// ── TC-5: W2 — cmd_type must not be assigned the current lane_status ──────
// Fixed in Phase 4 (REQ-6), not Phase 2 — cmd_type's effect on this bug is
// via the run marker's `action` field feeding orphan-reconcile
// classification (spawnCli's last arg -> buildRunMarker -> action), a
// separate concern from Phase 2's Lane/Lane-Status write-scope narrowing.
test('TC-5 (Phase 4 fixes this): cmd_type must not be assigned lane_status inside the waitingForReply branch', () => {
  assert.ok(
    !SYNC_SRC.includes('cmd_type = lane_status;'),
    'a conversation reply must dispatch a non-lane action — assigning cmd_type = lane_status makes an orphaned reply run classifiable as an orphaned lane action (e.g. a crashed "done" dispatch) by classifyOrphanedDispatch, which is wrong: no lane action ever ran'
  );
});
