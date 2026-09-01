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
import { resolveWorkspaceMode } from '../services/workspace-mode.mjs';
import { formatBlockComment, decidePreSpawnBlockOutcome, BLOCK_KINDS } from '../services/prespawn-block.mjs';

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
//
// Phase 5 update: the actual fix is the opt-in `requireProducedForAnyChange`
// flag (see TC-11) — NOT a change to the guard's default behavior, which the
// DB->disk pull site depends on to keep allowing legitimate forward moves
// (e.g. a human dragging a card forward in the UI) with a permanent
// `producedByThisRun: false`. This case is asserted WITH the flag set,
// matching how the exit handler's own call site now invokes it.
test('TC-1 (Phase 5 fixes this): forward write over a fresher on-disk lane, not produced by this run, should be blocked (with requireProducedForAnyChange)', () => {
  const r = shouldBlockLaneWrite({
    onDiskLane: 'plan',
    intendedLane: 'implement',
    producedByThisRun: false,
    requireProducedForAnyChange: true,
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

// ── TC-2c: narrowing the write scope must not drop unrelated bookkeeping ──
// **Last Run** / last_run.log are not part of the lane state machine —
// confirm the exit handler's "4. Update Last Run" step is not gated behind
// writeScope, i.e. it stays outside the `if (writeScope.canWriteLane)`
// block this phase introduced.
test('TC-2c: Last Run / last_run.log writes are not gated behind writeScope', () => {
  const lastRunBlock = SYNC_SRC.slice(SYNC_SRC.indexOf('// 4. Update Last Run'));
  const nextSectionIdx = lastRunBlock.indexOf('// 4. Write last run log');
  const runByBlock = lastRunBlock.slice(0, nextSectionIdx);
  assert.ok(runByBlock.includes('**Last Run**'), 'sanity: found the right block');
  assert.ok(!runByBlock.includes('writeScope'), 'Last Run must be written unconditionally, not gated on this run\'s write scope');
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

// ── TC-5: W2 — cmd_type must not be reassigned to a lane inside the
// waitingForReply branch specifically ─────────────────────────────────────
// Fixed in Phase 4 (REQ-6), not Phase 2. Scoped to the waitingForReply
// block's own source range: `let cmd_type = lane_status;` is the
// LEGITIMATE default declaration for a normal (non-reply) lane-action
// dispatch, a few lines above this branch — a plain whole-file substring
// check would false-positive on that unrelated, correct line, so this
// isolates just the `if (waitingForReply) { ... }` block's body before
// asserting. cmd_type's effect on this bug is via the run marker's
// `action` field (spawnCli's last arg -> buildRunMarker -> action) — a
// human or future process reading conductor/.runs/<track>.json for this
// run must not see a lane name for what is actually a conversation reply.
test('TC-5 (Phase 4 fixes this): cmd_type must not be reassigned to lane_status/a lane inside the waitingForReply branch', () => {
  const branchStart = SYNC_SRC.indexOf('if (waitingForReply) {');
  assert.ok(branchStart !== -1, 'sanity: found the waitingForReply branch');
  // The branch is self-contained well within the next ~200 lines (verified
  // against current source); slicing bounds the search to this branch's
  // body without needing a full brace-matching parser.
  const branchBody = SYNC_SRC.slice(branchStart, branchStart + 4000);
  assert.ok(
    !branchBody.includes('cmd_type = lane_status') && !/cmd_type = ['"]implement['"]/.test(branchBody),
    'inside the waitingForReply branch, cmd_type must never be reassigned to the current lane_status or hardcoded to a lane name like "implement" — a conversation reply must dispatch a non-lane action'
  );
});

// ── TC-9 (Phase 4, REQ-7/AC-5): a conversation-reply run must never resolve
// to workspace 'main' via a stale laneStatus ─────────────────────────────
// The end-to-end version of this (no main-mode lock actually acquired) is
// not observable in the local-fs test harness — checkAndClaimGlobalMainModeLock
// is only ever called when `!getIsLocalFs()` (spawnCli:~4776), so a
// local-fs sandbox structurally never reaches that branch regardless of
// workspaceMode. What IS directly verifiable: (a) resolveWorkspaceMode
// really would force 'main' for laneStatus 'plan'/'done' if it were called
// normally — proving the bypass below is not moot — and (b) the real
// dispatch code actually skips that call for a conversation run.
test('TC-9 (Phase 4 fixes this): a conversation-reply run bypasses resolveWorkspaceMode, so it can never resolve to \'main\' via a stale laneStatus', () => {
  // Sanity: this is the exact incident shape (Finding 2, track AM-10040) —
  // resolveWorkspaceMode forces 'main' for these laneStatus values
  // unconditionally, with no way to opt out via trigger/marker/type.
  for (const laneStatus of ['plan', 'done']) {
    assert.equal(
      resolveWorkspaceMode({ laneStatus, trigger: 'manual-dispatch' }),
      'main',
      `sanity: resolveWorkspaceMode(laneStatus=${laneStatus}) really does force 'main' when called normally — this is what a reply run must never reach`
    );
  }
  assert.ok(
    /isConversationRun\s*\?\s*null\s*:\s*resolveWorkspaceMode/.test(SYNC_SRC),
    'spawnCli must force workspaceMode to null for isConversationRun, never falling through to resolveWorkspaceMode\'s real (laneStatus-driven) computation — otherwise a reply dispatched while the track sits in plan/done resolves to workspace:main and takes the global main-mode lock for a run that never touches code or branches'
  );
});

// ── TC-10 (Phase 4, REQ-8/AC-7): a blocked lane-action retry must read
// distinctly from "needs your reply" ──────────────────────────────────────
// Turned out to be satisfied by construction rather than needing a new
// signal: once Tasks 1-2 make cmd_type/workspace never derive from a
// conversation run's snapshot, handlePreSpawnBlock (the actual "blocked,
// will retry" mechanism) is only ever reached via a GENUINE lane-action
// dispatch — never via the conversation-reply path, genuine or stale flag
// alike (the stale-flag case was already closed by the earlier
// hasGenuineUnansweredHumanComment fix, commit ab25d5f). Verified directly:
// handlePreSpawnBlock/formatBlockComment never touch **Waiting for reply**,
// and their comment text reads as "blocked/retry", never "needs your
// reply" — so the two states were already textually and mechanically
// distinct; what needed fixing was only that a reply could reach this path
// mislabeled as itself, which Tasks 1-2 close.
test('TC-10 (Phase 4, satisfied by construction): a pre-spawn block never sets waiting_for_reply and never reads like "needs your reply"', () => {
  for (const action of ['warn', 'escalate']) {
    const outcome = decidePreSpawnBlockOutcome({
      kind: BLOCK_KINDS.MAIN_MODE_LOCK, reason: 'held by another track', countBefore: action === 'escalate' ? 10 : 0,
    });
    const body = formatBlockComment(outcome);
    if (body) {
      assert.ok(!/needs your reply/i.test(body), `block comment must not read like a reply request: "${body}"`);
      assert.ok(/blocked|retry/i.test(body), `block comment should clearly read as a blocked retry: "${body}"`);
    }
  }
  const handlerSrc = SYNC_SRC.slice(SYNC_SRC.indexOf('async function handlePreSpawnBlock'), SYNC_SRC.indexOf('async function spawnCli('));
  assert.ok(
    !handlerSrc.includes('Waiting for reply') && !handlerSrc.includes('waiting_for_reply'),
    'handlePreSpawnBlock must never set **Waiting for reply** — a blocked lane-action retry is not a request for human input, and conflating the two was Finding 2\'s original complaint'
  );
});

// ── TC-12 (Phase 5, REQ-9 non-regression): every real transition in
// workflow.json must still pass the guard under the stricter mode ────────
// The exit handler's own call site now always passes
// requireProducedForAnyChange: true (Task 2's wiring) — this proves that
// tightening didn't accidentally block a single one of this project's own
// real lane transitions, forward or backward, as long as producedByThisRun
// is true (the normal, uncontended case for every real dispatch).
test('TC-12: every on_success/on_failure transition in workflow.json passes the guard when producedByThisRun (the normal case)', () => {
  const workflow = JSON.parse(readFileSync(new URL('../workflow.json', import.meta.url), 'utf8'));
  let checked = 0;
  for (const [laneName, laneCfg] of Object.entries(workflow.lanes)) {
    for (const key of ['on_success', 'on_failure']) {
      const value = laneCfg[key];
      if (!value || value === 'stay' || value === 'stop') continue;
      const [targetLane] = value.split(':');
      checked++;
      const r = shouldBlockLaneWrite({
        onDiskLane: laneName,
        intendedLane: targetLane,
        producedByThisRun: true,
        requireProducedForAnyChange: true,
      });
      assert.equal(r.blocked, false, `${laneName}.${key} = "${value}" (${laneName} -> ${targetLane}) must not be blocked when produced by this run`);
    }
  }
  assert.ok(checked >= 7, `sanity: expected to check every lane's on_success/on_failure — only checked ${checked}`);
});

// ── TC-13 (Phase 5, REQ-10): the two audited snapshot-writer sites route
// through applyGuardedLaneWrite, not a raw regex patch ────────────────────
test('TC-13: max-retries failure write and supervised-implement "done" transition both route through applyGuardedLaneWrite', () => {
  const maxRetriesStart = SYNC_SRC.indexOf('max retries (${maxRetries}) reached');
  assert.ok(maxRetriesStart !== -1, 'sanity: found the max-retries block');
  const maxRetriesBlock = SYNC_SRC.slice(maxRetriesStart, maxRetriesStart + 1200);
  assert.ok(maxRetriesBlock.includes('applyGuardedLaneWrite'), 'max-retries failure write must route through applyGuardedLaneWrite, not an unconditional regex patch');
  assert.ok(maxRetriesBlock.includes("readIfExists(indexPath)"), 'max-retries failure write must re-read fresh rather than reusing content captured earlier in this iteration');

  const supervisedStart = SYNC_SRC.indexOf('supervised implement "done" detected');
  assert.ok(supervisedStart !== -1, 'sanity: found the supervised-implement block');
  const supervisedBlock = SYNC_SRC.slice(supervisedStart, supervisedStart + 2000);
  assert.ok(supervisedBlock.includes('applyGuardedLaneWrite'), 'supervised-implement "done" transition must route through applyGuardedLaneWrite, not an unconditional regex patch');
  assert.ok(supervisedBlock.includes('readIfExists(indexPath)'), 'supervised-implement "done" transition must re-read fresh rather than reusing content captured earlier in this iteration');
});
