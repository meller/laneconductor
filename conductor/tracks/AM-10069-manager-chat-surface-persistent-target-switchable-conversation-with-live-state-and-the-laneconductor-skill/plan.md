# Track AM-10069: Manager chat surface — persistent, target-switchable conversation with live state and the /laneconductor skill

Eight phases. Phases 1 through 4 carry no blocking dependency on track 10067 and can start
immediately; phases 5 onward consume its merged REQ-14/REQ-17 (see spec.md D7).

**Sequencing note, revised 2026-09-06.** The boundary with track 10067 changed after this
plan's first pass (commit `aa5e0958`): 10067 now ships visibility only, and every
interactive piece — the chat-target resolver, the composer, the pseudo-track's
filesystem-backed conversation adapter, the reply-pickup trigger and the `syncConversation`
skip — moved into this track as the new Phase 4. What remains consumed from 10067 is a
directory containing `index.md` and `conversation.md`, so Phase 4 is built against a fixture
folder and only Phase 8's end-to-end verification needs the merged track. The blocking
dependency the first pass flagged is therefore gone.

---

## Phase 1: Instance state snapshot and setup-gap detection (REQ-12..REQ-13, REQ-16)

**Problem**: Scope items 4 and 5 both need the same thing — a cheap, deterministic answer
to "what does this instance actually look like right now, and what is missing." Neither
should cost a model turn, and the wizard gate in particular must be free for an
already-configured user.
**Solution**: Two pure modules with injected I/O (matching `stuck-track-sweep.mjs` and
`orphan-worker-detection.mjs`), one CLI surface and one API surface over them. No UI yet.

- [ ] Task 1.1: `conductor/services/instance-state.mjs` — pure module, all I/O injected,
      returning `{ projects[], tracksByLane, workers[], providers, generatedAt }`.
    - [ ] Per project: id, name, repo_path, track counts per lane, worker count
    - [ ] Per worker: id, hostname, type, project_id, current_task, last_heartbeat,
          derived `online` using the same staleness window `isWorkerOffline` uses — import
          the threshold, do not restate it
- [ ] Task 1.2: `conductor/services/setup-gaps.mjs` — pure module implementing spec.md
      D4's table, returning `[{ id, severity, subject, detail, remedy }]`.
    - [ ] `severity` is exactly `blocking` or `advisory`; nothing else
    - [ ] `remedy` is a concrete command or UI action string per gap, used verbatim by
          Phase 7's wizard message (REQ-19)
- [ ] Task 1.3: `lc state --json` in `bin/lc.mjs` — serializes Task 1.1's snapshot with
      Task 1.2's gaps attached. Non-`--json` form prints a short human summary.
- [ ] Task 1.4: `GET /api/state` in `ui/server/index.mjs` — same snapshot for the UI,
      respecting the existing worker-visibility scoping (`AUTH_ENABLED` branch used by
      `/api/workers/:id/chat-history`), so a shared instance does not leak other users'
      workers through a new endpoint.
- [ ] Task 1.5: Build the compact **digest** projection (D3) as a function of the snapshot,
      with a hard character budget and a test asserting it stays under it.

**Impact**: A single authoritative source for instance state, usable by the CLI, the API,
the wizard gate, and the manager's own prompt — instead of four ad-hoc reads.

---

## Phase 2: Live-turn affordances in the shared transcript reducer (REQ-20..REQ-24)

**Problem**: Scope item 7 asks for elapsed time, running tokens and a changing status line.
All of it already arrives over the existing WS `session:event` channel and is discarded by
`reduceStreamEvent` (spec.md's Problem Statement table, verified against a real 862-event
log).
**Solution**: Extend the reducer to carry a `turn` object beside `blocks`, and render it.
No worker change, no CLI-invocation change, no new endpoint.

- [ ] Task 2.1: Extend `ui/src/lib/streamTranscript.js`'s state to
      `{ blocks, turn }` where `turn` = `{ active, startedAt, lastEventAt, outputTokens,
      contextTokens, activity, model, sessionId }`.
    - [ ] `blocks` behaviour is byte-for-byte unchanged — existing tests must pass untouched
    - [ ] `system/init` seeds `model`, `sessionId` and marks the turn active
    - [ ] `assistant.timestamp` and `message.usage` drive `lastEventAt` and `contextTokens`,
          reusing `extractSessionContextTokens`'s rule (assistant events only, never
          `result` — its cache figure is cumulative across the run)
    - [ ] `stream_event`/`message_delta` `usage.output_tokens` drives `outputTokens`
    - [ ] `result` (or stream end) clears `active`
- [ ] Task 2.2: Derive `activity` (REQ-21) from real events, in priority order:
      `content_block_start` with a `tool_use` block → that tool's name; `system/status` →
      its `status` value; `system/thinking_tokens` → thinking. Never a static fallback
      while active.
- [ ] Task 2.3: Surface `turn` from `useTrackTranscript` alongside `blocks` and `rawLog`.
- [ ] Task 2.4: `TurnStatusBar` component — elapsed timer (ticks while active, freezes on
      end), token count, activity label. Renders nothing when `turn.active` is false and no
      tokens were seen, so a non-Claude raw-log run shows no empty chrome (REQ-24).
- [ ] Task 2.5: Mount it in the three existing surfaces that already share the hook —
      `TrackDetailPanel`, `WorkerActivityLatch`, `WorkerChatPanel` (AC-12).

**Impact**: Every transcript surface in the app gains the affordances at once, with one
implementation. Independent of 10067 — shippable on its own.

---

## Phase 3: The persistent Chat view and target switcher (REQ-1..REQ-5)

**Problem**: Chat is three modals today, each scoped to something other than "a target I
keep talking to."
**Solution**: A real view in `viewMode`, with a target list and the existing transcript and
composer pieces inside it.

- [ ] Task 3.1: Add `'chat'` to `App.jsx`'s `viewMode` union and a **Chat** nav button
      beside CI/CD, ungated by `selectedProjectId` the way Projects is (REQ-1).
- [ ] Task 3.2: `ChatView.jsx` — two-pane layout: target list left, transcript + composer
      right. Reuses `useTrackTranscript`, `TranscriptView`, `TrackChatComposer`,
      `CommentBubble` and Phase 2's `TurnStatusBar`. **No second renderer.**
- [ ] Task 3.3: Target list — the manager first and selected by default, then workers,
      each row showing live status via the existing `workerStatus.js` helpers (REQ-3). The
      manager row renders here but only resolves to a usable target once Phase 4's resolver
      lands; until then it shows the transcript with a disabled composer, which is exactly
      today's behaviour rather than a new dead end.
- [ ] Task 3.4: Persist the selected target across re-renders and project switches
      (REQ-2), and preserve per-target scroll position on switch back (REQ-4).
- [ ] Task 3.5: Add a Chat entry to `MobileMoreSheet` so the view is reachable on mobile
      without redesigning it for mobile (spec.md Out of Scope).
- [ ] Task 3.6: Worker-target tier (D5) — for a worker target, resolve through the existing
      `resolveWorkerChatTarget` and post through the existing comments endpoint, i.e.
      10037's behaviour relocated into the persistent pane, not reimplemented.

**Impact**: One place to sit and watch. Worker targets are fully functional at the end of
this phase even before the manager tier lands.

---

## Phase 4: Manager chat plumbing — resolver, composer, filesystem conversation adapter, reply pickup (REQ-25..REQ-31)

**Problem**: The revised 10067 boundary (spec.md D7) moved every interactive piece of manager
chat into this track, and none of it exists today. The resolver returns `null` for managers,
the composer is hard-disabled, both comments routes assume a `tracks` row the pseudo-track
deliberately does not have, the claim scan skips any folder without a digit, and
`syncConversation` mis-parses the folder name as a track number and POSTs to nothing.
**Solution**: One reserved-name branch in each of the five places that need it — no new
subsystem, no second renderer, no DB row. Built against a fixture `manager/` folder so the
phase does not block on merged 10067 (REQ-31).

- [ ] Task 4.1: `resolveWorkerChatTarget()` returns
      `{ trackNumber: 'manager', projectId: fallbackProjectId, source: 'manager' }` for
      `type === 'manager'` (REQ-25). Keep the `null` return for an idle non-manager worker
      with no last-context track — that case is still genuinely "nothing to talk about".
- [ ] Task 4.2: Enable `WorkerChatPanel`'s composer for a manager target and drop the
      "Managers are transcript-only" hint (REQ-26). Phase 3's pane reuses the same composer,
      so both surfaces gain it from this one change.
- [ ] Task 4.3: `GET /api/projects/:id/tracks/:num/comments` — reserved-name branch reading
      `conductor/tracks/manager/conversation.md` through `parseConversationComments()` and
      mapping turns to the `{ id, author, body, created_at }` shape `useTrackComments`
      already renders. No `getTrackId`, no 404 (REQ-27).
- [ ] Task 4.4: `POST .../comments` — reserved-name branch that skips `collectorWrite`,
      appends the turn in the documented `> **human**: …` format, advances `.conv-cursor`
      exactly as the existing branch does, sets `**Waiting for reply**: yes` in the
      pseudo-track's `index.md`, and broadcasts `track:updated` (REQ-27, D8).
- [ ] Task 4.5: `autoLaunchLocalFs` — admit the reserved name past both digit guards
      (`isTrackDirName` and the `dir.match(/(\d+)/)` skip) **only** when that marker is set,
      force `CONVERSATION_REPLY_ACTION`, and bypass every path that assumes a numbered track
      (lane transition, `claimableSet`, `autoRun`, dependency gating) (REQ-28, D8).
    - [ ] Assert the negative as its own test: with the marker absent, the folder is still
          skipped by both guards — the property that keeps the pseudo-track off the board.
- [ ] Task 4.6: `syncConversation` — explicit reserved-name early return, leaving
      `extractTrackNumber`'s shared fallback untouched, since its callers reach well outside
      this track (REQ-29).
- [ ] Task 4.7: Confirm invisibility end to end: no Kanban card, no `tracks.md` line, no
      `tracks` row, before and after a full chat exchange (REQ-30).

**Impact**: The manager becomes addressable end to end with no DB row, and this track's
dependency on 10067 shrinks to "a directory with two files in it".

---

## Phase 5: Manager target — skill-driven turns with live state (REQ-6..REQ-8, REQ-14, REQ-15)

**Problem**: The manager tier is the part that is genuinely new: a free-form turn with real
tool access, grounded in this instance's state.
**Solution**: Route the manager target's messages through Phase 4's plumbing into the
supervision pseudo-track and let the existing conversation-reply path answer them, with
Phase 1's digest injected on the opening turn only.

- [ ] Task 5.0 (**contract assertion — do this first, spec.md D7**): assert the two things
      this track still consumes from merged 10067, and nothing more: `conductor/tracks/manager/`
      exists per supervised project with `index.md` and `conversation.md` (its REQ-14), and
      the reserved folder name contains no digit in any position (its REQ-21). Write a test
      for each.
    - [ ] Until 10067 merges, run this phase against Phase 4's fixture folder and leave the
          assertion failing rather than stubbing it — a green stub here is exactly the false
          pass this ordering exists to prevent.
    - [ ] A rename, or a digit anywhere in the reserved name, is a shared-contract break:
          raise it on 10067 rather than adding a compensating pattern here. Reply pickup is
          no longer in that category — Phase 4 owns it (D8).
- [ ] Task 5.1: Manager-target composer posts into the supervision track's conversation
      through the same comments endpoint (REQ-6) — no new dispatch action, `track_chat`
      untouched (AC-14).
- [ ] Task 5.2: Inject Phase 1's digest into the manager session's **opening** turn only,
      alongside the line telling it `lc state --json` returns the full snapshot on demand
      (REQ-14). Gate re-injection on the same fresh-vs-resumed signal the existing paths
      use — `session.isFresh` / `resumingChat` (REQ-15).
- [ ] Task 5.3: Surface session continuity state in the pane: which session is live, and an
      explicit notice when track 10047's context cap resets it (REQ-8) rather than a silent
      restart.
- [ ] Task 5.4: Verify tool calls render live in the pane during a manager turn (REQ-7) —
      this should require no new code, since the events are the same ones Phase 2 already
      handles; the task is the verification, and fixing anything it exposes.

**Impact**: The manager becomes something you can actually ask questions and get grounded,
tool-backed answers from.

---

## Phase 6: Queued intervention semantics (REQ-9..REQ-11)

**Problem**: Sending during a live turn appears to work and silently does nothing for the
duration of that turn — the deferral at `laneconductor.sync.mjs:6866` is correct behaviour
that the UI does not communicate.
**Solution**: Make the queueing visible and self-resolving. No mid-stream injection (D1).

- [ ] Task 6.1: Expose per-target run liveness to the UI — whether a run marker is live for
      the target's track, and what action it is running. Prefer deriving it from data the
      workers/tracks endpoints already return; add a field only if genuinely absent.
- [ ] Task 6.2: Composer shows **queued** state on send during a live turn, naming what it
      is waiting on (REQ-9), instead of an unqualified "Sending…".
- [ ] Task 6.3: Clear the queued state when the reply turn picks the message up, driven by
      the existing WS events rather than a new poll (REQ-10).
- [ ] Task 6.4: Wording review — nothing in the pane may imply the running turn is being
      interrupted (REQ-11).

**Impact**: The one behaviour most likely to read as "the chat is broken" becomes legible.

---

## Phase 7: Conditional setup wizard (REQ-17..REQ-19)

**Problem**: A new instance needs guidance; a configured one must not be nagged, and must
not pay a model turn for the system to decide that.
**Solution**: Gate on Phase 1's deterministic gap list; render the opening message client-side.

- [ ] Task 7.1: On opening the Chat view, fetch `GET /api/state` and read its gaps.
- [ ] Task 7.2: Render the wizard opening message only when a **blocking** gap exists
      (REQ-17), naming each gap and its `remedy` verbatim from Phase 1 (REQ-19).
- [ ] Task 7.3: Advisory gaps render as a dismissible header note, never an opening message.
- [ ] Task 7.4: Assert the zero-gap path is inert: no `worker_dispatch` row, no spawned
      process, no comment written (REQ-18 / AC-10).

**Impact**: First-run guidance that costs nothing on every subsequent run.

---

## Phase 8: Real-product verification and documentation

**Problem**: Unit tests cannot detect a chat surface that was never wired up. Several of
this track's requirements are only observable by driving the real app against a real
worker.
**Solution**: Drive it, record what was observed, then document.

- [ ] Task 8.1: Restart the worker and API before verifying — neither hot-reloads, and this
      repo has produced false passes from exactly that (see the skill's quality-gate step 2a).
- [ ] Task 8.2: Playwright spec covering AC-1, AC-8, AC-9 and AC-10.
- [ ] Task 8.3: Manual end-to-end run of AC-2 through AC-7 against a live manager, with the
      observed result recorded in `conversation.md` — including the `lc status` comparison
      AC-2 requires and the log-derived token check AC-5 requires.
- [ ] Task 8.4: Confirm AC-14 — the Activity panel's `track_chat` bar still works.
- [ ] Task 8.4b: Confirm Phase 4's plumbing against the **real** merged 10067 pseudo-track,
      not the fixture: AC-15 through AC-19 — composer enabled, turn lands in
      `conversation.md`, `GET .../tracks/manager/comments` returns it with no `tracks` row
      created, a worker answers within one auto-launch cycle, the pseudo-track appears on no
      board and in no `tracks.md`, and the worker log carries no failed
      `/track/manager/comment` POSTs.
- [ ] Task 8.5: Update `conductor/product.md`'s feature-availability table with a Chat row,
      and document `lc state` in the skill's command reference.
- [ ] Task 8.6: Re-check spec.md's Out of Scope list against what actually shipped; anything
      deferred stays deferred and unchecked, and the track does not reach 100% while a
      Solution-level capability is missing.

**Impact**: The track is verifiably real, not plausibly real.
