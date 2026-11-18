# Track 10141: Stale running claims and human comments mid-run: claim stamp, stale-running lint, warning

New `connector/src/claims.mjs`; wiring in `update_track`, `get_track`, `list_tracks` and the board. No new tool text (KC-8).

- [x] 1. Claim stamp: when `update_track` sets Lane Status to running (or moves the lane while running), it also writes `**Run Started**` (ISO time) and `**Run By**` (client name and connector session). The stamps are derived, not part of the caller's base; the returned base carries them.
- [x] 2. Release: any other Lane Status removes both stamps, so a human or agent releases a stale claim by moving the track to queue.
- [x] 3. Stale-running warning: running with a Run Started older than 6 hours is reported as `stale_running` by `get_track`, one aggregate line in `list_tracks`, and a needs-attention reason on the board (deterministic from its generated time). The summary lint is left alone: the summary file must not depend on the clock.
- [x] 4. Human comment mid-run: when a call changes Lane or Lane Status, the caller read conversation.md, it has changed since, and its newest turn is the human's, the write succeeds and carries a `human_comment_mid_run` warning. A CONFLICT option (`expect_conversation`) was not added: it would cost tool-description text.
- [ ] 5. Skipped: "no commit on its branch" (the connector does not know the run's branch; an unstamped claim cannot be judged and is not flagged); resting-state lint from workflow.json (needs a decision on which non-terminal successes are resting; not done).
  - skipped: needs an owner decision to descope
- [x] 6. All warnings are kept under the 200 character warning bound.
