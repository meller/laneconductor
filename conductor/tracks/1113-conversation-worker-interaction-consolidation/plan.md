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

### Addendum (2026-08-14): plain "Send" ("💬 Message") still didn't dispatch

**Found live** (not in the original Phase 2 scope): plain Send remained a
passive `sendComment()`-only post — `SEND_MODE_HELP` explicitly documented
this as a known caveat ("nothing runs until you dispatch — use a Run
mode"), meaning gap 1 was still open for the plain-message case even
though Send & Run closed it for explicit lane dispatches.

**Design note — deviates from D1's original sketch, flagged not hidden**:
D1 envisioned "Send & Run → [lane▾]" defaulting to the current
`lane_status` as covering "keep going," implying plain Send should
dispatch a *lane action*. What shipped instead routes plain Send through
`track_chat` — the same mechanism Brainstorm uses — a considered choice
(chat is read-only/non-mutating; defaulting every casual message to a
real, git-lock-taking lane action felt like the wrong default), not an
oversight. See conversation.md's review entry for the full reasoning.

- [x] `handleComposerSend`: `sendMode === 'send'` now takes the same
      branch as `'brainstorm'` — persists the comment (`no_wake: true`)
      then calls `dispatchTrackChat(text)`, which resolves the worker via
      `resolveWorkerId()` (handles "+ New worker…" the same as every other
      dispatching control)
- [x] `needsOnlineWorker` includes `'send'`, so the button correctly
      disables when no usable worker is selected/available — matching
      Run/Brainstorm instead of being the one mode that didn't check
- [x] `SEND_MODE_HELP.send` and the stale explanatory comment above it
      (both described the now-superseded passive behavior) updated
- [ ] **Not done as part of this addendum**: TC-1 through TC-6 (Phase 2's
      own test cases) remain unwritten — this fix reuses Brainstorm's
      already-proven path but doesn't itself add automated coverage.
      Regression suites this area touches (1085/1086/1087/
      sync-conversation-parser) re-run clean, 17/17.

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

- [x] `conductor/laneconductor.sync.mjs`: `track_chat` calls
      `resolveTrackSession()` and passes `--session-id` (fresh) /
      `--resume` (shared) instead of the from-scratch file-concatenation
      prompt (REQ-5). Context injection is skipped on a resumed session.
- [x] `persistTrackSession()` called after a successful `track_chat` turn
- [x] `activeDispatch` checked before claiming a `track_chat` entry; a
      lane action in flight for the same track leaves it `pending` for a
      later cycle to re-serve (REQ-6)
- [x] `updateWorkerHeartbeat('idle', null)` guarded by `runningPids.size
      === 0`; otherwise logs and leaves the lane action's `busy` intact
      (REQ-7)
- [x] Confirmed scheduling/sequencing only — no IPC into a running foreign
      process was added (true mid-run interrupt remains FFU)
- [x] Verified by automated test (Phase 5), not a manual check — see below
- [x] **Implementation note (2026-08-14)**: built once on the `track-1113`
      branch, but not merged before a separate live incident that same day
      (a human's message to track 182 went unanswered) drove an
      independent, simpler fix for the REQ-8 half directly on `main` — see
      Phase 4 below for how these were reconciled rather than shipped as
      two competing mechanisms.

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

- [x] **Mechanism changed from the original plan.** The original design
      (POST straight to `/track/:num/comment` from the chat handler) was
      built first on the `track-1113` branch, but a live incident the same
      day (2026-08-14, aitutor track 182: a human's chat message got a
      reply visible in the Transcript but never in Conversation) surfaced
      why that's the wrong mechanism: a direct API/DB write desyncs
      `conversation.md` (the source of truth a future AI turn reads) from
      `track_comments` (what the UI shows) — a worker restart mid-sync can
      then advance the file's cursor past content that was never actually
      parsed, silently losing it. This was proven live, not theoretically:
      it happened to a manually-written comment earlier the same session.
      **Fixed instead by appending the reply to `conversation.md`** in the
      standard `> **author**: body` turn format and letting the
      *pre-existing* conv-sync file watcher push it to `track_comments` —
      the same path every other reply in this file already uses. Still
      satisfies D3/REQ-8 (a `track_chat` reply becomes inbox-worthy) with
      one fewer parallel write path, not two.
- [x] `worker_adhoc_chat` (no `track_number`) explicitly excluded — the
      append is gated on `entry.action === 'track_chat' && chatTrack`
      (REQ-9)
- [x] No changes needed to `GET /api/inbox` — confirmed
- [x] Verified by automated test (Phase 5) against a real worker process,
      not a manual check

**Impact**: Closes gap 4 by reusing the mechanism that already works
correctly, rather than building a second parallel "unread" concept across
`worker_dispatch`.

## Phase 5: Tests — E2E covering "message means go do more work" end to end

**Problem**: None of the above is real until it's proven against an
actual `sync-only` worker, since that's precisely the configuration where
gap 1 was invisible (queued correctly, silently never claimed).
**Solution**: Write/extend E2E coverage that exercises the full path on a
real worker process, matching `test.md`'s test cases.

- [x] Cover Phase 3: `conductor/tests/track-1113-chat-coordination.test.mjs`
      — REQ-5 (session mint on first turn, resume on second, same session
      id persisted), REQ-6/REQ-7 (chat turn deferred while a real lane
      action is in flight for the same track, worker heartbeat stays busy
      throughout, deferred chat still runs once the lane action exits) —
      against a real spawned `sync-only` worker
- [x] Cover Phase 4 (reconciled mechanism): `conductor/tests/
      chat-reply-conversation-md.test.mjs` — a `track_chat` reply is
      appended to `conversation.md` in the correct multi-line-safe format
      and reaches `track_comments` via the pre-existing conv-sync path;
      negative-controlled (disabling the append fails the suite)
- [x] **Negative controls, not just green runs**: both new suites were
      confirmed to fail when their respective fix was reverted (stubbing
      out the relevant branch with `if (false) { ... }`) before being
      trusted. Worth the extra step this pass specifically: two *other*
      tests written the same day (per-worker-machine-token's session-
      isolation case, chat-reply-conversation-md's format assertion)
      initially passed for the wrong reason — checking too early, or
      asserting on the wrong fragment of a multi-line write — and only
      negative-controlling caught it. The REQ-6/7 deferral test here
      already builds in the fix for that class of mistake (it waits for
      the worker's own "Deferring chat turn" log line, not just "still
      pending," which is trivially true before any cycle has run).
- [ ] Cover Phase 2 (Send & Run → different lane, asserting an actual
      `queue → running → success` transition) — still NOT written; Phase
      2 itself records this as open (TC-1..TC-6 unwritten). Genuinely
      outstanding, not carried over into this pass's scope.
- [x] Regression: track-1084/1085/1086/1087 and sync-conversation-parser
      all pass unchanged (31/31 total across every suite this pass and the
      same day's other fixes touched)

**Impact**: Prevents this track's own failure mode — a plausible-looking
fix that was never actually exercised against a real `sync-only` worker —
from recurring.

## Implementation note (2026-08-14)

Phases 3, 4, 5 complete. Not moved to `done`: Phase 2 has two genuinely
open items (header "Run <lane> now" not folded in; TC-1..6 unwritten).
Moved to `review` at 90%, per the done-gate rule — honestly documenting a
deferral does not make a track complete.

Motivating incident: track 182 (aitutor) had a conversation message
posted while a plan dispatch was still running; the run finished via a
`--resume` continuation and never re-read `conversation.md`, silently
dropping the human's input. That's the FFU half of D2 (true mid-run
interrupt), still out of scope. What Phase 3 fixes is the adjacent,
buildable half — chat and lane actions on a track now share one session
and are sequenced rather than raced.

Separately, the same incident's follow-up (a chat reply visible in the
Transcript but never in Conversation) exposed that this track's own
Phase 3/4 work had been built twice, on two branches, using two different
mechanisms for REQ-8. Reconciled today: REQ-5/6/7 merged from the
original `track-1113` branch; REQ-8 keeps the file-append mechanism
(append to `conversation.md`, let the existing conv-sync watcher push it
to `track_comments`) that the live incident proved correct, over the
branch's original direct-DB-write version.
