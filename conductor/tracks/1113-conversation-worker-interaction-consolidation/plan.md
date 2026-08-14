# Track 1113: Conversation ↔ Worker Interaction Consolidation

## Phase 1: Design — interaction model for message → worker action

**Problem**: The conversation panel, inbox, transcripts, and worker-chat
grew as four separate tracks (015, 1085, 1086, 1087) whose interaction
semantics no longer compose — traced live to four concrete root causes
(see `index.md` Problem section).
**Solution**: Decide the button set, Send semantics, chat/lane-action
coordination, and inbox scope as concrete, code-grounded decisions —
recorded in `spec.md` (D1/D2/D3, REQ-1..9). Also corrected a factual error
in the live session record: "Send & Run → \<lane\>" was recorded as
already shipped; it does not exist anywhere in the repo (checked `main`,
`track-1112`, this worktree's uncommitted state, and `git log --all`).

- [x] Trace all four gaps to exact file/line root causes (done live,
      2026-08-13 — see `index.md`)
- [x] Survey current implementation: `TrackDetailPanel.jsx` button
      handlers, `worker_dispatch`/dispatch endpoints, `track_chat`
      handling in `conductor/laneconductor.sync.mjs`, `track_sessions`,
      Inbox query, transcript/chat-bar wiring, `conversation.md` sync
      round-trip
- [x] Verify the "Send & Run" shipped-already claim against actual repo
      state (main / track-1112 / uncommitted / all-branches search) —
      found it does not exist; corrected in `spec.md`
- [x] Decide button set (D1): collapse Send/Replan/header-"Run now" into
      one lane-aware "Send & Run → [lane ▾]" control; keep Post
      Note/Bug/Brainstorm/+New Track; fix Brainstorm's incidental
      `no_wake` bug
- [x] Decide chat coordination scope (D2): shared `track_sessions` for
      `track_chat`, defer-not-concurrent execution against a running lane
      action, fix heartbeat clobber; explicitly mark true mid-run
      interrupt as FFU (no CLI mechanism exists for it)
- [x] Decide inbox scope (D3): completed `track_chat` writes a
      `track_comments` row (reuses existing Inbox query, no new tables);
      `worker_adhoc_chat` and raw transcripts stay ephemeral, explicitly
      out of Inbox
- [x] Write `spec.md` with decisions, requirements (REQ-1..9), and
      acceptance criteria phrased as user-observable outcomes

**Impact**: Phases 2-5 below now build against concrete decisions instead
of the "(to be designed)" placeholder that was in `index.md` before this
phase.

## Phase 2: Send & Run control (build, not finalize — see spec.md correction)

**Reconciliation note (2026-08-13, post-planning)**: this phase's core —
lane-and-worker-aware Send & Run, comment→PATCH→dispatch in order, fixed
Brainstorm `no_wake` — was independently implemented and committed
(`20e0374`) in the same live session, concurrently with this track's own
planning dispatch running in its isolated worktree. The planning agent's
"does not exist" verification was accurate at the exact moment it ran
(checked `main`/`track-1112`/uncommitted/`git log --all`) — the commit
landed afterward. Reconciled below rather than left stale or silently
overwritten.

**Problem**: No control exists today that lets a human message mean "go
back to lane X and do more work" — `sendComment()` can only re-queue the
track's *current* lane via a general-queue signal that `sync-only`
workers never poll (gap 1); Replan and the header "Run \<lane\> now"
button are two more dead-end/disconnected partial attempts at the same
thing (gap 2).
**Solution**: D1 — one lane-and-worker-aware control that posts a comment
(`no_wake: true`), optionally PATCHes `lane_status`, then dispatches via
`POST /api/tracks/:id/dispatch`, in that order.

- [x] `ui/src/components/TrackDetailPanel.jsx`: composer collapsed into
      one mode selector (`sendMode`: send/note/run:\<lane\>/brainstorm/bug)
      + one Send button whose label/color/helper text reflect the
      selected mode — a broader consolidation than the original "lane
      picker next to the box" sketch, same underlying requirement met
- [x] Send's `onClick` (`handleComposerSend`) routes `run:<lane>` through
      `sendComment(undefined, lane, true, undefined, true)` →
      comment → `PATCH lane_status` → `dispatchRunNow`, awaited in that
      order (REQ-1/2/3)
- [x] Replan removed entirely (not just its old behavior folded in) —
      subsumed by `Send & Run → plan`
- [ ] Header "Run \<lane\> now" button (`dispatchRunNow`, ~line 623)
      **NOT removed** — still present alongside the composer's Send & Run.
      Deliberately left as-is rather than removed sight-unseen: it works
      with no message text (composer's Send requires non-empty `draft`),
      a real distinct case ("just re-run this stage, nothing to say").
      Consolidating cleanly (e.g. letting Send & Run fire with an empty
      draft) is real remaining work, not done here.
- [x] Brainstorm fixed — but via dispatch, not `no_wake`: routes through
      an actual `track_chat` dispatch (`dispatchTrackChat`) instead of the
      dead `Waiting for reply: yes` + `autoLaunchLocalFs` poll path, which
      is hard-skipped for `sync-only` workers regardless of `no_wake`
      (`conductor/laneconductor.sync.mjs:5055`). Stronger fix than the
      planned one — the original poll-based mechanism can never work on
      this project's actual worker configuration no matter how `no_wake`
      is set.
- [x] Post Note, Bug, +New Track unchanged (still present in the mode
      selector / as their own controls)
- [x] Manual check done live: track 1112 in `review`, sent "lets do phase
      7 as well" via Send & Run → implement — worker (`sync-only`) picked
      up dispatch 39 within seconds, track transitioned
      `review → implement`, `lane_action_status: queue → running`,
      confirmed via DB + live UI screenshot (Logs tab correctly showed the
      in-progress banner).

**Impact**: Closes gap 1 for both worker modes; collapses 3 dead-end/
duplicate controls (Send's old behavior, Replan, header Run-now) into 1
working one.

## Phase 3: Chat coordination — shared session, no concurrent execution, no heartbeat clobber

**Problem**: `track_chat` is a fully independent code path from lane
actions — no session resume, no check for an in-flight lane action on the
same track/worker (can spawn concurrently against the same worktree), and
an unconditional `idle` heartbeat write on completion that can clobber a
still-running lane action's `busy` status (gap 3).
**Solution**: D2 — route `track_chat` through `track_sessions`, sequence
it after any in-flight lane action for that track/worker instead of
running concurrently, and make the heartbeat write conditional. True
mid-run interrupt is FFU (see spec.md Out of Scope).

- [ ] `conductor/laneconductor.sync.mjs`: in the `track_chat` branch of
      `checkDispatchInbox` (~line 4758), call `resolveTrackSession()` and
      pass the resulting `--resume`/`--session-id` args instead of the
      current from-scratch file-concatenation prompt (REQ-5)
- [ ] Call `persistTrackSession()` after a successful `track_chat` turn,
      same as the lane-action path does
- [ ] Before spawning a `track_chat` turn, check `activeDispatch` (or
      equivalent) for an in-flight lane action on the same
      `(track_number, worker_id)`; if found, defer the chat dispatch
      (leave it `pending`, don't claim) until that lane action's process
      exit is observed (REQ-6)
- [ ] `updateWorkerHeartbeat('idle', null)` on chat completion
      (~line 4838): guard it — only force `idle` if no lane action is
      still active for this worker; otherwise leave/restore `busy` (REQ-7)
- [ ] Explicitly do NOT attempt to inject into an already-running foreign
      process — confirm this stays purely a scheduling/sequencing fix, not
      an IPC feature
- [ ] Manual check: start an `implement` run, send a `track_chat` message
      for the same track before it finishes — confirm only one CLI process
      is running at a time and the worker's heartbeat status stays `busy`
      until the lane action truly exits

**Impact**: Closes gap 3's two concrete bugs (no coordination, heartbeat
clobber); explicitly scopes out what isn't buildable given today's CLI
invocation model.

## Phase 4: Inbox consolidation — track-scoped chat via `track_comments`

**Problem**: Inbox is driven entirely by `track_comments`; `track_chat`
replies live only in `worker_dispatch.result` and are invisible to the
Inbox no matter how long they sit unread (gap 4).
**Solution**: D3 — on `track_chat` completion, also insert a
`track_comments` row, so the existing Inbox query (`unreplied_count`,
`human_needs_reply`) picks it up unchanged. `worker_adhoc_chat` and raw
transcripts stay out of the Inbox by explicit decision, not omission.

- [ ] `conductor/laneconductor.sync.mjs`: after a `track_chat` dispatch
      completes successfully (has a `track_number`), insert a
      `track_comments` row via the existing comment-post path (author =
      the CLI that answered; body = the chat result) (REQ-8)
- [ ] Confirm `worker_adhoc_chat` (no `track_number`) is explicitly
      excluded from this — no comment insert attempted (REQ-9)
- [ ] Confirm no changes needed to `GET /api/inbox`'s query — the point of
      D3 is that reusing `track_comments` requires zero new query surface
- [ ] Manual check: send a `track_chat` message for a specific track, wait
      for the reply, confirm it appears in both the Conversation tab and
      the Inbox's unreplied count without any other change
- [ ] Manual check: send a `worker_adhoc_chat` (no track selected) message,
      confirm its reply does NOT appear in the Inbox

**Impact**: Closes gap 4 by reusing the mechanism that already works
correctly, rather than building a second parallel "unread" concept across
`worker_dispatch`.

## Phase 5: Tests — E2E covering "message means go do more work" end to end

**Problem**: None of the above is real until it's proven against an
actual `sync-only` worker, since that's precisely the configuration where
gap 1 was invisible (queued correctly, silently never claimed).
**Solution**: Write/extend E2E coverage that exercises the full path on a
real worker process, matching `test.md`'s test cases.

- [ ] Cover Phase 2: Send & Run → different lane, on a `sync-only` worker,
      asserting the worker actually spawns and the track's
      `lane_action_status` transitions `queue → running → success` (not
      just that the DB row was written)
- [ ] Cover Phase 3: concurrent `track_chat` + in-flight lane action on
      the same track — assert only one CLI process runs at a time and
      heartbeat stays `busy` throughout
- [ ] Cover Phase 4: `track_chat` reply surfaces in `GET /api/inbox`;
      `worker_adhoc_chat` reply does not
- [ ] Regression: Post Note, Bug, Brainstorm, +New Track still behave as
      before (no `no_wake` regressions from the Brainstorm fix)

**Impact**: Prevents this track's own failure mode — a plausible-looking
fix that was never actually exercised against a real `sync-only` worker —
from recurring.
