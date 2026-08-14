# Spec: Conversation ↔ Worker Interaction Consolidation

## Correction to the live-session record

Track 1112's dogfooding session recorded "Send & Run → \<lane\>" in
`TrackDetailPanel.jsx` as **shipped already (2026-08-13, this session)**.
That is not what's in the repo: checked `main`, the `track-1112` branch,
this worktree's `git status`, and `git log --all` for the string — the
control does not exist anywhere. What exists today is `dispatchRunNow()`
(`ui/src/components/TrackDetailPanel.jsx:207-224`), an unrelated header
button labeled "Run \<lane\> now" that calls `POST
/api/tracks/:id/dispatch` with the track's *current* lane — it has no
connection to the comment box, and no lane-selection UI. The perceived
"fix" was evidently discussed/designed live but never committed.

**Consequence for this track**: Phase 2 is not a finalization pass on
existing code — it is the actual build. The design below reflects that.

## Problem Statement

(See `index.md` — Problem section — for the full live-traced root-cause
narrative. Summary of the four gaps, restated as design inputs:)

1. `sendComment()` (`TrackDetailPanel.jsx:283-315`) can only re-queue the
   track's *current* `lane_status` — `UPDATE tracks SET lane_action_status
   = 'queue' ... WHERE lane_status IN ('plan','implement','review',
   'quality-gate') AND lane_action_status != 'running'`
   (`ui/server/index.mjs:2606-2612`). It writes to the **general
   auto-launch queue** signal, which a `sync-only` worker's poll loop
   never reads (per `product.md`'s worker-mode design) — only that
   worker's own `worker_dispatch` inbox is checked in that mode. A message
   meaning "go back to `implement`" while the track sits in `review` is
   silently inert on such a worker: correctly written to the DB, never
   claimed, no error surfaced anywhere.
2. Four conversation-box controls (Send / Post Note / Brainstorm / Replan)
   are all thin wrappers around one `sendComment(textOverride,
   newLaneStatus, noWake, command)` call with different argument
   combinations, plus a fifth, structurally separate "Run \<lane\> now"
   button that goes through the real dispatch mechanism
   (`POST /api/tracks/:id/dispatch`, which validates `action ===
   track.lane_status` server-side — `ui/server/index.mjs:3110-3112`) but
   has no comment attached and no lane choice. Replan
   (`sendComment(undefined, 'plan', false, 'replan')`) posts a comment,
   triggers the same inert general-queue wake as Send (against whatever
   lane the track is in *before* the PATCH fires), and only then PATCHes
   `lane_status: 'plan'` — it never dispatches, so it dead-ends exactly
   like Send.
3. `track_chat`/`worker_adhoc_chat` dispatches
   (`conductor/laneconductor.sync.mjs:4758-4842`) are deliberately routed
   around `spawnCli`/`buildCliArgs`/`track_sessions` (by design — a chat
   turn shouldn't take a git lock or create a worktree). But this means:
   no session resume (always a fresh one-shot `-p` call re-injecting
   `index.md`/`spec.md`/`plan.md`/`conversation.md` as raw text each time,
   `sync.mjs:4787-4798`), no check against a lane action already running
   for the same track (`checkDispatchInbox`'s 10s interval is fully
   independent of the lane-action poll loop — a chat turn can spawn a
   second CLI process concurrently with a running `implement`), and no
   heartbeat coordination — `updateWorkerHeartbeat('idle', null)` on chat
   completion (`sync.mjs:4838`) unconditionally overwrites the `workers`
   row even if a lane action is still `busy`, because heartbeat writes are
   last-write-wins with no mutex (`sync.mjs:847-877`).
4. The Inbox (`GET /api/inbox`, `ui/server/index.mjs:722-766`) is a pure
   `track_comments` query (`unreplied_count` = claude/gemini comments
   newer than the human's last comment; `human_needs_reply` = human
   comments with `is_replied = FALSE`). `track_chat` prompts/replies live
   *only* in `worker_dispatch.payload.prompt` / `worker_dispatch.result`
   (confirmed: no code path anywhere writes a chat turn into
   `track_comments`) — so a chat reply the human hasn't seen yet never
   raises `unreplied_count` and never appears in the Inbox, regardless of
   how long it's been sitting unread.

## Decisions

### D1 — Collapse the button set; make "Send" lane-aware

Replace the four comment-box controls with three, plus keep the header
"Run now" button folded into the same control:

- **Send & Run → [lane ▾]** (replaces Send, Replan, and
  `dispatchRunNow`'s header button): a lane picker defaulting to the
  track's current `lane_status` (covers "keep going" — the old Send's
  common case) but changeable to any of `plan` / `implement` / `review` /
  `quality-gate` (covers "go back and do more" — the case that silently
  failed in the 1112 session) and a worker picker (reuses whatever worker
  list already backs `dispatchRunNow`). On submit, in this order:
  1. `POST .../comments` with `no_wake: true` (dispatch below is the wake
     mechanism now — the general-queue side effect is no longer used for
     this control, so it must not also fire).
  2. If the chosen lane differs from `detail.lane_status`: `PATCH
     .../tracks/:num { lane_status: <chosen>, lane_action_status: 'queue'
     }`.
  3. `POST /api/tracks/:id/dispatch { worker_id, action: <chosen> }` —
     this is the real, worker-mode-agnostic execution path; it works
     identically whether the worker is `sync-only` or `sync+poll`,
     closing gap 1 for both.
  Ordering matters — the dispatch endpoint requires `action ===
  track.lane_status`, so the PATCH (step 2) must land before the dispatch
  call (step 3); enforce this client-side (await each step) rather than
  firing them concurrently.
- **Post Note** — unchanged (`no_wake: true`, no lane change, no
  dispatch). Real, distinct use case: a comment for the record that
  shouldn't trigger anything.
- **Bug** — unchanged. Real side effect (`test.md` regression block +
  `lane_status: 'plan'` PATCH), keep as-is.
- **Brainstorm** — keep the distinct Q&A path (`Waiting for reply: yes`),
  but fix an incidental bug found while tracing it: today's call
  (`sendComment(undefined, undefined, false, 'brainstorm')`) passes
  `noWake: false`, so it *also* fires the same inert general-queue wake as
  Send, for no reason — a brainstorm question isn't asking the worker to
  resume a lane action. Change the call to `noWake: true`.
- **+ New Track** — unchanged (orthogonal, opens the modal seeded with the
  draft).

**Removed**: the standalone Replan button (folded into Send & Run → plan)
and `dispatchRunNow`'s separate header button (folded into Send & Run's
default-lane case). `dispatchRunNow()`'s underlying call
(`POST /api/tracks/:id/dispatch`) is reused, not removed — the header
button that called it directly is what goes away.

### D2 — Chat coordination: shared session, no true mid-run interrupt

Investigated what "coding-agent-style interrupt/resume" can actually mean
given the CLI is invoked via one-shot `-p` calls with no IPC channel into
a running foreground process — there is no way to inject into a process
`spawnCli` already started without the CLI itself exposing a control
channel, which it doesn't. So the literal "interrupt a running turn"
half of the request is **out of scope / FFU** for this track; documented
here explicitly so it isn't silently implied as done. What Phase 3 will
build, which does deliver the useful half — "answer the question, then
continue what you were doing" without losing context or clobbering
worker state:

- Route `track_chat` (not `worker_adhoc_chat` — that one has no
  `track_number` and nothing to resume) through the same
  `resolveTrackSession()` / `track_sessions` machinery a lane action uses,
  so a chat reply and a subsequent (or preceding) lane action for the same
  `(track, worker)` share one Claude session and its context, instead of
  the chat handler's current from-scratch file-concatenation prompt.
- Before spawning a `track_chat` turn, check whether a lane action is
  currently active for that same track on that worker (existing
  `activeDispatch` map). If so, queue the chat turn to run immediately
  after the in-flight lane action's process exits, rather than spawning a
  second concurrent process against the same worktree.
- Fix the heartbeat clobber: the chat handler's
  `updateWorkerHeartbeat('idle', null)` on completion must not fire if a
  lane action for that worker is still active — restore the lane action's
  `busy` status instead of forcing `idle`.

### D3 — Inbox: track-scoped chat becomes inbox-worthy by reusing `track_comments`; worker-scoped chat stays ephemeral

Decision (resolving gap 4's open question explicitly, not by accident):

- When a `track_chat` dispatch (has a `track_number`) completes, also
  insert a `track_comments` row (`author: 'claude'` or the CLI in use,
  `body: result`) tagged so it's identifiable as chat-sourced. This is the
  entire fix — the Inbox's existing `unreplied_count` /
  `human_needs_reply` logic already does the right thing for any row in
  `track_comments`, so no new query surface, no new "unread" tracking
  table. The transcript panel and Conversation tab both already render
  `track_comments`, so the reply becomes visible in both places for free.
- `worker_adhoc_chat` (no `track_number`) has no per-track home and stays
  **out of** the Inbox by design — it remains visible only in the Activity
  panel (`WorkerActivityLatch.jsx`'s chat history). This is the explicit
  "transcripts/non-track chat are ephemeral" half of gap 4's either/or.
- Live session transcripts (stream-json events) are **not** promoted into
  `track_comments` — they stay a separate, ephemeral view. Only the
  chat *reply* (already a discrete, addressed-to-the-human message) is
  duplicated into `track_comments`; the underlying tool-call/thinking
  event stream is not conversation-shaped and would flood the Inbox if
  treated as such.

## Requirements

- REQ-1: A `POST .../comments` call from the new Send & Run control never
  also triggers the general-queue wake path (`no_wake: true` always).
- REQ-2: `POST /api/tracks/:id/dispatch` remains the sole mechanism Send &
  Run uses to trigger execution; the client must not rely on the
  general-queue `lane_action_status = 'queue'` side effect of posting a
  comment to cause a worker to act.
- REQ-3: Send & Run's PATCH (lane change) must complete before its
  dispatch POST fires, for any lane other than the track's current one.
- REQ-4: Brainstorm's `sendComment` call passes `no_wake: true`.
- REQ-5: `track_chat` dispatches use `resolveTrackSession()` /
  `--resume`/`--session-id` against the same `track_sessions` row a lane
  action for that `(track, worker)` would use.
- REQ-6: A `track_chat` dispatch for a track with an in-flight lane action
  on the same worker is deferred until that lane action's process exits,
  not run concurrently.
- REQ-7: Chat-turn completion does not set worker heartbeat to `idle` if a
  lane action for that worker is still active.
- REQ-8: A completed `track_chat` dispatch inserts a corresponding
  `track_comments` row, so it surfaces through the existing Inbox query
  unchanged.
- REQ-9: `worker_adhoc_chat` dispatches are explicitly excluded from
  REQ-8 (no `track_number` to attach a comment to).

## Acceptance Criteria

- [ ] On a `sync-only` worker, sending a message from a track sitting in
      `review` with lane target `implement` selected results in the
      worker actually starting an `implement` run on that track — not
      just a DB status change. (Verified by watching the worker actually
      spawn the CLI process and the track's `lane_action_status` progress
      through `queue → running`, on a real `sync-only` worker instance —
      not by inspecting dispatch-table rows alone.)
- [ ] The four old comment-box controls no longer include a separate
      "Replan" button; "Run \<lane\> now" no longer exists as a
      standalone header control.
- [ ] Asking a question via chat while a lane action is running for that
      track does not spawn a second concurrent CLI process for the same
      worktree, and does not flip the worker's heartbeat status to `idle`
      while the lane action is still running.
- [ ] A chat reply for a specific track appears in that track's Inbox
      unread state (and Conversation tab) without any manual action, using
      the existing Inbox query — i.e. `unreplied_count` increases from a
      completed `track_chat` dispatch the same way it would from a normal
      AI comment.
- [ ] A `worker_adhoc_chat` reply (no track) does **not** appear in the
      Inbox.
- [ ] `git log --all -S"Send & Run"` (or equivalent grep across branches)
      finds the control's actual implementation, confirming it now exists
      where the record previously only claimed it did.

## Out of Scope / FFU

- True mid-run interrupt (injecting a chat turn into an already-running
  foreground CLI process rather than sequencing before/after it) — no
  known mechanism in the CLIs this project drives; would need the CLI
  itself to expose a control channel.
- Promoting raw transcript/stream-json events into `track_comments` or the
  Inbox — explicitly decided against in D3.
