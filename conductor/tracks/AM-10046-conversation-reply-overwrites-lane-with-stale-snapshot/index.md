# Track AM-10046: local-fs-answer Overwrites Lane With a Stale Snapshot Under Concurrent Dispatch

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
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

- [ ] Phase 1: Locate and reproduce the exact race with a regression test
- [ ] Phase 2: Fix (re-read-before-write or narrow what a conversation-reply turn may touch)
