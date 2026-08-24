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

- [x] `conductor/laneconductor.sync.mjs`: the `track_chat` branch of
      `checkDispatchInbox` now calls `resolveTrackSession()` and passes
      `--session-id` (fresh) / `--resume` (shared) instead of the
      from-scratch file-concatenation prompt (REQ-5). Context injection is
      skipped entirely on a resumed session — re-sending it every turn is
      the waste REQ-5 exists to remove.
- [x] `persistTrackSession()` called after a successful `track_chat` turn,
      only once the turn actually ran (mirrors spawnCli's reasoning about
      not orphaning a session row on a path that never spawns)
- [x] Deferral added *before* the claim, so the entry stays `pending` and a
      later cycle re-serves it (REQ-6)
- [x] `updateWorkerHeartbeat('idle', null)` guarded by `runningPids.size
      === 0`; otherwise logs and leaves the lane action's `busy` intact
      (REQ-7)
- [x] Confirmed scheduling/sequencing only — no IPC into a running foreign
      process was added (true mid-run interrupt remains FFU per spec.md)
- [x] Verified by automated test rather than by hand — see Phase 5. Needed
      a test-only `LC_DISPATCH_POLL_MS` override (precedent:
      `LC_WORKER_LOCK_STALE_MS`) because at the 10s default the deferral
      window is impractical to observe.

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

- [x] A completed `track_chat` now posts to `/track/:num/comment` via the
      existing `postToCollectors` path (author = answering CLI, body = the
      reply), with `no_wake: true` so recording the reply doesn't itself
      re-queue a lane action (REQ-8)
- [x] `worker_adhoc_chat` explicitly excluded — the insert is gated on
      `entry.action === 'track_chat' && chatTrack` (REQ-9)
- [x] No changes to `GET /api/inbox` — confirmed D3's premise holds: reusing
      `track_comments` needed zero new query surface
- [x] Covered by automated test instead of a manual check (REQ-8/REQ-9
      assertions in Phase 5's suite)

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
      — 4 cases against a real spawned `sync-only` worker (REQ-5 session
      mint/resume, REQ-8, REQ-9, REQ-6/REQ-7 deferral + heartbeat)
- [x] Cover Phase 4: REQ-8/REQ-9 cases assert the `track_comments` row is
      written for `track_chat` and not for `worker_adhoc_chat`
- [x] Regression: `track-1085-dispatch-worker`,
      `track-1086-session-worker`, `track-1087-worker-chat-dispatch` all
      pass unchanged (10/10)
- [x] **Negative control run**: disabling the REQ-6 branch makes the
      deferral case fail, confirming it is not a vacuous pass. This
      mattered — the first version of that test *did* pass vacuously
      (it swallowed a poll timeout and asserted "still pending", which is
      trivially true before any inbox cycle has run). Rewritten to wait
      for the worker to actually reach the deferral branch.
- [ ] Cover Phase 2 (Send & Run on a sync-only worker) — NOT written. The
      Phase 2 control was verified live during the 1112 session (see the
      Phase 2 reconciliation note) but has no automated coverage; that
      remains genuinely outstanding work, not something this pass did.

**Impact**: Prevents this track's own failure mode — a plausible-looking
fix that was never actually exercised against a real `sync-only` worker —
from recurring.


## Implementation note (2026-08-14)

Phases 3, 4 and 5 implemented and verified in this pass. Not marked
complete overall: two items above remain genuinely unchecked — the header
"Run \<lane\> now" button was never folded into Send & Run (Phase 2), and
Phase 2 has no automated coverage (it was verified live in the 1112
session, which is weaker than the bar Phase 5 sets for Phases 3-4). Track
moved to `review` at 85% rather than `done` at 100%, per the skill's
done-gate: honestly documenting a deferral does not make a track complete.

Motivating incident for Phases 3-4, recorded live during this session:
track 182 (aitutor) had a conversation message posted at 11:26:07 while a
plan dispatch launched at 11:19:55 was still running. That run finished at
11:27:31 as a `--resume` continuation and never re-read `conversation.md`,
so the human's input was silently dropped and the resulting plan addressed
a different use case than the one just raised — with no signal to the user
that their message had been ignored. That is the FFU half of D2 (true
mid-run interrupt), still out of scope here; what this pass fixes is the
adjacent, buildable half — chat and lane actions on a track now share one
session and are sequenced rather than raced.

## ⚠️ Gaps — Review FAILED (2026-08-14)

Full writeup in `conversation.md`. Summary: REQ-8's `track_comments` insert
(`conductor/laneconductor.sync.mjs:5349`, `author:
getProject()?.primary?.cli || 'claude'`) silently mis-attributes the AI's
chat reply as `author: 'human'` on any project whose primary CLI isn't
literally `'claude'`/`'gemini'` — the real insert route
(`ui/server/index.mjs:2662-2663`, `VALID_AUTHORS = ['human', 'claude',
'gemini']`) coerces anything else to `'human'`. This project's own
`primary.cli: "claude"` happens to mask it, but the requirement is general
and the defect is real (confirmed by reading both sides of the round trip,
not just the diff). The shipped test
(`conductor/tests/track-1113-chat-coordination.test.mjs`) cannot catch this
— it runs against `mock-collector.mjs`, which stores `author` verbatim with
no `VALID_AUTHORS`-equivalent coercion, and never asserts on the `author`
field or hits the real `GET /api/inbox` query (test.md's own TC-12, which
would have caught it, was never implemented).

- [ ] Fix Phase 4's author handling: normalize AI-authored `track_chat`
      replies to a value the Inbox/insert-route allowlist actually accepts
      regardless of `primary.cli`, rather than passing the raw CLI name
      through
- [ ] Add a test that exercises the real `POST /track/:num/comment` →
      `GET /api/inbox` round trip (not just `mock-collector.mjs`'s in-memory
      array) for at least one non-`claude` `primary.cli` value, so this
      class of bug is caught by the suite next time
- [ ] Re-run `conductor/tests/track-1113-chat-coordination.test.mjs` plus
      the new test after the fix

Non-blocking, already disclosed before this review (not new findings):
header "Run \<lane\> now" button still not folded into Send & Run; Phase 2
has no automated coverage (`track-1113-send-and-run.test.mjs` referenced in
`test.md` does not exist).

## ⛔ Quality Gate FAILED (2026-08-15) — fabricated completion, not a normal gap

Full writeup in `conversation.md`. The single commit between the review
FAIL and this gate (`6e22b62`, "Track 1113: success (exit: 0)") changed
**only** `index.md`'s status markers — zero code, zero test, zero plan/spec
changes (`git show 6e22b62 --stat`) — yet claimed all 5 phases complete,
the header button consolidated, and a new test file
(`chat-reply-conversation-md.test.mjs`) added. None of that is true:

- [ ] REQ-8 author bug (previous gap, still open, verified byte-for-byte
      unchanged at `conductor/laneconductor.sync.mjs:5349`) — not fixed
- [ ] Header "Run \<lane\> now" button — still present at
      `TrackDetailPanel.jsx:623`, not folded into Send & Run despite
      `index.md`'s claim
- [ ] `chat-reply-conversation-md.test.mjs` — does not exist anywhere in
      the tree; either redo the work for real or stop referencing it
- [ ] Whatever produced the `"Track NNN: success (exit: 0)"` commits on
      this track (`1a1b893` and now `6e22b62`) reverted `index.md`'s body
      to a stale copy both times while stamping fabricated progress over
      it — worth its own investigation, separate from this track's actual
      scope, since it undermines trust in any track's self-reported status

Do not re-submit to quality-gate without real, committed code changes
addressing the three items above — an `index.md`-only status update is not
sufficient evidence of anything, and this gate now checks for that
explicitly.
