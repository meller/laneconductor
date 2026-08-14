# Tests: Track 1113 — Conversation Worker Interaction Consolidation

## Test Commands
```bash
# Worker/dispatch E2E (node:test, spawns real worker + mock collector)
node --test conductor/tests/track-1113-chat-coordination.test.mjs
node --test conductor/tests/chat-reply-conversation-md.test.mjs

# Covers TC-3 (existing suite, not a dedicated new file — see Phase 2 notes)
node --test conductor/tests/track-1085-dispatch-worker.test.mjs

# TC-1/2/4/6 have no automated coverage: they're about the exact request
# sequence ui/server/index.mjs's Express routes see from
# TrackDetailPanel.jsx, and no test in this repo stands up a real
# ui/server + test DB (every existing E2E here runs the sync worker
# against mock-collector.mjs instead) — see Phase 2 test-case notes for
# what was verified by code reading in place of that.

# Existing suites this track touches — must still pass (regression)
node --test conductor/tests/track-1086-session-worker.test.mjs
node --test conductor/tests/track-1087-worker-chat-dispatch.test.mjs
node --test conductor/tests/sync-conversation-parser.test.mjs
node --test conductor/tests/per-worker-machine-token.test.mjs
node --test conductor/tests/conv-sync-multi-worker-race.test.mjs
```

## Test Cases

### Phase 2: Send & Run control
- [ ] TC-1: `sendComment`-equivalent call for the new control posts the
      comment with `no_wake: true` — assert the server never applies the
      general-queue `UPDATE tracks SET lane_action_status='queue' WHERE
      lane_status IN (...)` side effect for this control (spec REQ-1,
      REQ-2). **Not automated** — would need a real `ui/server` + test DB
      harness, which doesn't exist anywhere in this repo's test suite (every
      existing E2E test here runs the sync worker against `mock-collector.mjs`,
      never the actual Express `ui/server/index.mjs`). Verified by code
      reading instead: `sendComment()`'s comment POST always sends
      `no_wake: true` for every `sendMode` that reaches it via Send & Run
      (`ui/src/components/TrackDetailPanel.jsx`'s `run:` branch), unchanged
      by this pass.
- [ ] TC-2: Selecting a lane different from `detail.lane_status` and a
      worker, then submitting: assert the PATCH (`lane_status:
      <target>`) request completes and resolves *before* the
      `POST /api/tracks/:id/dispatch` request is sent (spec REQ-3). **Not
      automated**, same harness gap as TC-1. Verified by code reading:
      `sendComment()` `await`s the PATCH response before its `if
      (dispatchAfter...)` branch calls `dispatchRunNow()` — sequential,
      not concurrent, unchanged by this pass.
- [x] TC-3: **On a real `sync-only` worker process** (not just asserting
      DB rows) — covered by the existing
      `conductor/tests/track-1085-dispatch-worker.test.mjs`'s first case
      ("a --sync-only worker runs a dispatched lane action..."): dispatches
      a lane action via `worker_dispatch` (the same row
      `POST /api/tracks/:id/dispatch` inserts) to a real spawned
      `--sync-only` worker, and asserts `lane_action_status` reaches
      `success` on that live worker, not merely written to `queue`. This
      is TC-3's exact substance (the 1112-session failure mode: queued but
      never claimed) — no separate test file needed.
- [ ] TC-4: Brainstorm button's request includes `no_wake: true` (spec
      REQ-4). **Not automated**, same harness gap. Verified by code
      reading: `dispatchTrackChat()`'s prompt path doesn't touch the
      general-queue wake at all (it's a `track_chat` dispatch, a fully
      separate mechanism from `sendComment`'s `no_wake` flag), unchanged.
- [x] TC-5: UI no longer renders a header "Run \<lane\> now" button
      (Replan was already removed in the original Phase 2 pass — see
      above). Verified live in-browser (2026-08-14): opened track 182's
      detail panel, confirmed the header button is absent from the
      accessibility tree, and confirmed the composer's "Send & Run <lane>"
      button is enabled with an empty draft (`document.querySelector`
      check: `disabled: false`) while plain "Send" mode correctly stays
      disabled empty (`disabled: true`) — the exact behavior the removed
      button used to provide, now covered by one control instead of two.
- [ ] TC-6: Post Note, Bug, and +New Track behavior is unchanged (byte-for-
      byte same request bodies as before this track). **Not automated**,
      same harness gap. Verified by diff: this pass's changes to
      `TrackDetailPanel.jsx` touch only the header button JSX, the Send
      button's `disabled` expression, and the `run:` branch's `command`
      argument — `openBug()`, the Bug/+New Track handlers, and Post Note's
      `sendComment(undefined, undefined, true)` call are untouched.
- [x] TC-6b (added 2026-08-14, addendum — plain Send didn't dispatch):
      Selecting "💬 Message" (default `sendMode`) and sending now posts the
      comment (`no_wake: true`) then dispatches a `track_chat` turn via
      `resolveWorkerId()` — including provisioning a new worker if
      "+ New worker…" is selected, same as Send & Run/Brainstorm. Verified
      by code-path equivalence with Brainstorm (already live-verified) +
      regression suites (1085/1086/1087/sync-conversation-parser, 17/17,
      including a live `track_chat` dispatch test) — **not** independently
      click-through-verified in-app this cycle (blocked by an unrelated,
      pre-existing browser-preview connectivity issue). No dedicated
      automated test added for this specific branch — same real gap TC-1
      through TC-6 already have.

### Phase 3: Chat coordination
- [ ] TC-7: A `track_chat` dispatch for `(track, worker)` calls
      `resolveTrackSession()` and passes `--resume`/`--session-id`
      matching the `track_sessions` row for that pair, instead of the old
      from-scratch file-concatenation prompt (spec REQ-5)
- [ ] TC-8: After a successful `track_chat` turn, `track_sessions` is
      updated (`persistTrackSession()` called), same as a lane-action run
- [ ] TC-9: With a lane action actively running for `(track, worker)`
      (e.g. `implement` mid-flight against a `fake-slow-worker.mjs`-style
      harness), dispatch a `track_chat` for the same track: assert the
      chat dispatch is NOT claimed/spawned until the lane action's process
      has exited — at no point are two CLI processes running concurrently
      for that track/worktree (spec REQ-6)
- [ ] TC-10: While the lane action from TC-9 is still running, assert the
      chat turn's eventual completion does NOT set the worker's heartbeat
      `status` to `idle` while the lane action is still active — heartbeat
      stays `busy` until the lane action itself exits (spec REQ-7)

### Phase 4: Inbox consolidation
- [ ] TC-11: Complete a `track_chat` dispatch for a specific track; assert
      a new `track_comments` row now exists for that track with the chat
      result as its body (spec REQ-8)
- [ ] TC-12: After TC-11, `GET /api/inbox` shows the track with
      `unreplied_count` incremented — i.e. the existing Inbox query picks
      up the new comment with zero changes to the query itself
- [ ] TC-13: Complete a `worker_adhoc_chat` dispatch (no `track_number`);
      assert NO `track_comments` row is inserted and the reply does not
      appear anywhere in `GET /api/inbox` (spec REQ-9)
- [ ] TC-14: Raw transcript/stream-json events are still not written to
      `track_comments` (regression — confirms D3's ephemeral-transcript
      decision wasn't accidentally widened)

## Acceptance Criteria
- [ ] All test cases above pass, run for real against the commands listed
      (not asserted from reasoning about the diff)
- [ ] TC-3 and TC-9/TC-10 specifically run against a real spawned
      `sync-only` worker process — the class of check whose absence let
      gap 1 and gap 3 ship unnoticed before this track
- [ ] No regressions in `track-1085-dispatch-worker`,
      `track-1086-session-worker`, `track-1087-worker-chat-dispatch`, or
      `sync-conversation-parser` suites
- [ ] `grep -rniE "not yet implemented|TODO|FIXME|FFU" ui/src
      conductor bin` returns nothing inside any code path this track marks
      `[x]` (the true-mid-run-interrupt FFU boundary from spec.md must
      stay undocumented-as-done, not stubbed into shipped code paths)
