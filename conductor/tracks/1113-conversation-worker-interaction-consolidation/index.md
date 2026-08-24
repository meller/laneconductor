# Track 1113: Conversation ↔ Worker Interaction Consolidation

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Phase**: All 5 phases complete. Header "Run <lane> now" button consolidated into Send & Run (2026-08-14, verified live in-browser). TC-3/TC-5 now covered; TC-1/2/4/6 remain without dedicated automated…
**Type**: dev
**Waiting for reply**: no
**Summary**: The conversation panel, inbox, transcripts, and worker-chat grew as four separate tracks (015, 1085, 1086, 1087) and their interaction semantics no longer compose — found live while dogfooding track…

## Problem

Found live (2026-08-13, track 1112 dogfooding session). The user sent
"lets do phase 7" to a track sitting in `review`, expecting it to go back
to implement. What actually happened: nothing visible at all. Root causes
traced one by one:

1. **"Send" semantics don't match user intent.** The wake logic
   (`POST /track/:num/comment`, `ui/server/index.mjs`) re-queues whatever
   lane the track is *currently* in — it cannot express "this message
   means go back to lane X and do more work." On a `sync-only` worker
   (which never polls the queue), even that re-queue is inert: correctly
   queued, never picked up, no feedback anywhere.

2. **The conversation buttons are inconsistent about the same gap.**
   Traced each one:
   - **Bug** → appends a regression-test block to `test.md` + posts a
     comment (real side effect, keep).
   - **Brainstorm** → posts + sets `Waiting for reply: yes` (triggers the
     worker's Q&A/dialogue path, distinct from lane actions, keep).
   - **Replan** → posts + `PATCH lane_status: 'plan'` — but does NOT
     dispatch, so it dead-ends exactly like Send did (now redundant with
     Send & Run → plan; candidate for removal).
   - **+ New Track** → opens the modal seeded with draft (orthogonal, keep).

3. **Chat interrupts but doesn't resume.** A `track_chat` dispatch
   answers and returns the worker to `idle` unconditionally — there's no
   concept of "answer the question, then continue what you were doing"
   (the user explicitly asked for coding-agent-style interrupt/resume).
   Today chat and a running lane action are two uncoordinated processes.

4. **Inbox predates transcripts — consolidation was never done.** Track
   015 built the Inbox around `track_comments`/unreplied counts; track
   1087 later added live transcripts + a per-worker chat bar
   (`worker_adhoc_chat`/`track_chat` results live only in
   `worker_dispatch.result`, invisible to the Inbox). Three parallel
   message surfaces now exist — Conversation tab (track_comments),
   Transcript (stream-json events), worker chat (dispatch results) — with
   no unified model of "what has the AI said to me that I haven't seen."

## Solution (to be designed in plan phase)

- **Shipped already (2026-08-13, this session)**: "Send & Run → <lane>"
  in `TrackDetailPanel.jsx` — posts the comment, moves the lane, and
  immediately dispatches that lane's action on the selected worker (the
  dispatch API requires action === current lane, so ordering matters and
  is enforced client-side). This closes gap 1's immediate dead-end;
  its final UX belongs to this track.
- Decide the button set: fold Replan into Send & Run; keep Bug/Brainstorm
  (they have real distinct side effects); consider making Send itself
  lane-aware instead of a separate button.
- Design chat interrupt/resume (gap 3): whether `track_chat` during a
  running lane action should inject into the live session (1086's
  `track_sessions` makes resume possible) instead of spawning a parallel
  one-shot answer.
- Inbox consolidation (gap 4): one inbox over all three message surfaces,
  or an explicit decision that transcripts/chat are ephemeral and only
  track_comments are inbox-worthy — either way, decided rather than
  accidental.

## Phases
- [x] Phase 1: Design — interaction model for message → worker action
- [x] Phase 2: Send & Run UX — header button consolidated 2026-08-14; TC-1/2/4/6 still lack automated coverage (harness gap, see test.md)
- [x] Phase 3: Chat coordination — shared session (REQ-5), defer against in-flight lane action (REQ-6), no heartbeat clobber (REQ-7)
- [x] Phase 4: Inbox consolidation — track_chat reply reaches conversation.md → track_comments (mechanism changed from the original plan; see plan.md)
- [x] Phase 5: Tests — track-1113-chat-coordination.test.mjs, chat-reply-conversation-md.test.mjs, both negative-controlled

## Related tracks
- [015](../015-track-conversation-inbox/index.md) — built the Inbox (pre-transcripts)
- [1085](../1085-manual-worker-dispatch/index.md) — dispatch mechanism Send & Run reuses
- [1086](../1086-persistent-track-sessions/index.md) — track_sessions, prerequisite for chat interrupt/resume
- [1087](../1087-live-session-transcript-panel/index.md) — transcripts + chat bar (Phase 8 chat has no resume)
- [1112](../1112-git-sync-and-worktree-visibility/index.md) — the dogfooding session that surfaced all of this
