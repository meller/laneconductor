# Track AM-10046: local-fs-answer Overwrites Lane With a Stale Snapshot Under Concurrent Dispatch

**Lane**: plan
**Merge Mode**: direct
**Lane Status**: success
**Progress**: 0%
**Phase**: Planned
**Type**: dev
**Track Kind**: bug
**Author**: AM
**Created By**: asaf.meller@gmail.com
**Summary**: Live incident (2026-08-31, track AM-10045): **Lane** flapped implement -> plan -> implement -> implement -> plan -> implement over ~90 seconds. The conversation-reply ("local-fs-answer") handler…

## Problem

Discovered live while two separate sessions were both driving track AM-10045: one posted a
blocking question (`⏸️ Needs your input`) and the reply-handling turn ("local-fs-answer")
resumed to process the human's (absent, in this case) reply. That turn's own report:

> "my previous turn ended on a blocking question, which the worker's `local-fs-answer` handler
> treats as conversation-only — it skips normal transitions and instead force-writes `**Lane**`
> back to whatever value it captured **at that run's dispatch time**. That run got claimed
> mid-flap against a *separate*, concurrent `implement` attempt also fighting over the same
> field ... it captured a stale `plan` snapshot and, on completion, silently overwrote the
> `implement` I'd deliberately left in place last turn."

Net effect: a human-invisible, six-flip **Lane** oscillation in `index.md` over ~90 seconds,
driven by two independent dispatch paths (a lane-action spawn and a conversation-reply
resume) both reading/writing the same field with no coordination between them, and the
conversation-reply path using a **snapshot captured at its own dispatch time** rather than a
fresh read — so it can silently clobber a legitimate transition that happened after that
snapshot was taken, however long the reply turn takes to actually run.

This is a race on `**Lane**` itself, not merely a display/sync-timing issue (contrast
[[AM-10044-running-state-stuck-in-queue-display]], which is about `lane_action_status`
staleness) — a genuinely wrong value can be written back to disk.

## Finding 2 (2026-08-31, track AM-10040) — `waiting_for_reply` is conflated with "lane action needs a retry"

Distinct mechanism, same code region. `**Waiting for reply**: no
marker table) as meaning "a human comment needs an answer" — but the dispatch code
(`laneconductor.sync.mjs` ~6005-6011) does this when `waitingForReply` is true:

```js
label = 'local-fs-answer';
if (CLAIMABLE_LANES.includes(lane_status)) {
  cmd_type = lane_status;   // e.g. 'done'
} else {
  cmd_type = 'implement';
}
```

For a track sitting in a claimable lane (now including `done`, per Finding 5/track 10040) with
`waiting_for_reply: yes` set, this doesn't "answer a question" at all — it runs the **actual
lane action** (`cmd_type = 'done'` → `/laneconductor merge`) under the `local-fs-answer` label.
No human conversation is involved; the flag is being used as a generic "please retry this
lane's action" signal, indistinguishable from its documented meaning.

**Confirmed live**: track AM-10040 had a stray `**Waiting for reply**: yes` (leftover from an
unrelated leaked test-fixture dispatch, tracks 10044/10045's own root cause) long after it had
genuinely shipped (`done:success`, PR merged). Every worker poll cycle re-triggered a `merge`
retry labeled `local-fs-answer`, which collided with whatever else held the main-mode lock,
got blocked, and reverted `**Lane Status**` to `queue` as a side effect — with no distinct
signal anywhere that the track was "waiting to retry a merge" rather than "waiting for a
human's reply" or "broken." The board just looked like it kept becoming unmerged.

The pre-spawn-block machinery (`handlePreSpawnBlock`, track 10040 Phase 1) *does* fire
correctly for this case and even logs it — but under the misleading `local-fs-answer` label,
so its own diagnostic output reads as if a conversation-reply attempt failed, not a merge
retry.

**Added requirement**: `waiting_for_reply` must never be treated as "retry this lane's action."
A track resuming because a lane action needs to retry (e.g. blocked on main-mode lock, blocked
on a transient failure) needs its own distinct signal — surfaced to the human as something like
"⏳ waiting to merge — blocked by [reason]" — clearly different from "💬 needs your reply."
Concretely: `cmd_type` should never be set to the current `lane_status` inside the
`waitingForReply` branch; a genuine lane-action retry should go through the normal
claim/dispatch path (which already labels itself correctly, e.g. `local-fs-done`), not through
the conversation-reply path at all.

## Solution (to be refined at planning)

- Locate the `local-fs-answer` / conversation-reply-turn code path (likely near
  `checkDispatchInbox`'s brainstorm/reply handling in `laneconductor.sync.mjs`) and identify
  exactly where it captures the "current lane" snapshot and where it writes it back.
- The reply-turn should **re-read `**Lane**` immediately before writing**, not rely on a
  value captured at dispatch time — or better, only ever touch `**Waiting for reply**` and
  conversation content, never `**Lane**`/`**Lane Status**` at all, since a conversation reply
  is not itself a lane transition.
- Add a regression test simulating the exact race: a lane-action dispatch changes `**Lane**`
  while a conversation-reply turn (holding an earlier snapshot) is in flight; assert the
  reply turn's completion never reverts the lane-action's transition.
- Audit for other dispatch types that might read a "current state" snapshot at claim time and
  write it back unconditionally at completion — this pattern (stale-snapshot-wins) may not be
  unique to `local-fs-answer`.

## Related Tracks

- [[AM-10045-e2e-tests-leak-real-worker-from-worktree]] — where this was discovered, mid-way
  through resolving an unrelated dirty-checkout contention between two concurrent sessions
- [[AM-10044-running-state-stuck-in-queue-display]] — a different staleness symptom
  (`lane_action_status` vs DB/UI), possibly worth comparing root causes during planning

## Phases

- [ ] Phase 1: Reproduce the race with a failing regression test
- [ ] Phase 2: A conversation-reply run may not write `**Lane**` or `**Lane Status**` (all three writers)
- [ ] Phase 3: Serialize reply dispatch on the existing per-track run marker
- [ ] Phase 4: Stop conflating `waiting_for_reply` with a lane-action retry (Finding 2)
- [ ] Phase 5: Audit every other claim-time-snapshot writer; close the guard's forward direction

See `plan.md` for tasks, `spec.md` for the confirmed mechanism, `test.md` for TC-1..TC-13.
**Auto Run**: yes
