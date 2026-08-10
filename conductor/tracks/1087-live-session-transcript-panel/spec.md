# Spec: Live Session Transcript Panel (Track 1087)

## Problem Statement

Today's "Logs" tab (`TrackDetailPanel.jsx`) renders `last_log_tail` — a raw
text tail PATCHed every 5s by `spawnCli`'s `tailInterval`
(`conductor/laneconductor.sync.mjs:3122-3131`) from a plain-text `claude -p`
process. It's not structured, not real-time in any meaningful sense (5s lag,
full re-tail each time), and gives no way to distinguish assistant text from
tool activity. Once track 1086 unifies a track's lane actions and
conversation into one persistent session, that session's live event stream
is worth surfacing directly.

## Requirements

**REQ-1: Structured output from the worker**
- For `cli === 'claude'` spawns in `spawnCli`, add `--output-format
  stream-json --include-partial-messages` to the args.
- Non-Claude CLIs (gemini, antigravity) are unaffected — they don't support
  this flag; their runs keep today's plain-text tail behavior end-to-end
  (worker and UI).
- Stdout still goes to the existing log file path in `conductor/logs/`
  (`spawnCli`'s `logPath`) — this remains the persisted, disk-based audit
  trail regardless of DB/API availability.

**REQ-2: Event parsing and push**
- Worker parses newly-appended JSONL lines from the log file as they're
  written (not just at the 5s tick — react to file growth).
- Each parsed event (assistant text delta, tool_use, tool_result) is pushed
  to the collector API via a lightweight endpoint, replacing today's raw
  `last_log_tail` PATCH for claude spawns specifically.
- API relays each event over the existing WebSocket
  (`ui/src/hooks/useWebSocket.js`) to clients subscribed to that track.

**REQ-3: Transcript reconstruction**
- No new persistence layer — the JSONL log file is the source of truth.
- On track detail panel load, UI fetches and parses the full JSONL log for
  the current/most recent run to reconstruct transcript history, then
  subscribes to the WS feed for live continuation.

**REQ-4: UI — collapsible right-side panel**
- A drawer on the right edge of the track detail view (not a tab), usable
  alongside spec/plan/conversation content.
- Auto-expands when a run starts on the track currently being viewed
  (lane action, dispatch from 1085, or a conversation turn under 1086's
  unified session). User can collapse manually at any time.
- Renders: assistant text as chat-style blocks; tool calls as collapsible
  entries (e.g. "Used tool: Read(spec.md)"); falls back to raw `<pre>` text
  for any non-JSON lines (keeps non-Claude CLIs working without extra
  branching in the renderer).

**REQ-5: Cross-worker activity view**
- A developer can have several of their own workers registered to a project
  (`workers.user_uid`, track 1084 — no pin/grant step needed, e.g. a laptop
  and a cloud VM under the same identity), and several workers can be
  running different tracks in parallel. Add a live
  current-activity snippet per worker to `WorkersList.jsx` (e.g. last tool
  call or assistant text fragment, truncated), sourced from the same WS event
  stream as REQ-2 — not a full transcript, just enough to monitor several
  parallel runs at a glance without opening each track individually.
- Clicking a worker's activity snippet navigates to that track's detail view
  (REQ-4's drawer) for the full transcript — **for track-scoped runs**. See
  REQ-6 for runs with no associated track.

**REQ-6: Non-track dispatch transcripts (deploy, create-project, ...)**
**Corrected 2026-08-10** (original text below the line was wrong about the
architecture — kept, struck through in spirit, for history; do not
re-implement against it without reading the correction first):

`deploy` (1085) does **not** go through `spawnCli`/claude at all — it runs
through the entirely separate `conductor/deploy-runner.mjs`, which spawns
the project's configured shell deploy command(s) and logs plain shell
stdout/stderr to `conductor/logs/deploy-<env>-<timestamp>.log`. There is no
claude session, no stream-json, nothing for REQ-1-3's JSONL mechanism to
key by `worker_dispatch.id` — that premise was wrong, confirmed by reading
`deploy-runner.mjs` and `checkDispatchInbox`'s `entry.action === 'deploy'`
branch, which `continue`s before ever reaching `spawnCli`. `create-project`
(1091) doesn't exist yet — track 1091 is still in `plan` with 0% progress —
so there is no second real case to build against either.

**Revised scope**: a non-track dispatch transcript, for `deploy` today, is
a **raw-text log viewer** — reuse REQ-4's already-built fallback (the plain
`<pre>` block Phase 3 Task 4 uses for non-Claude CLI runs), fed by a new
endpoint that finds `conductor/logs/deploy-<env>-*.log` for a given
`worker_dispatch.id` (need to resolve env/timestamp from the dispatch row,
since the log filename doesn't contain the dispatch id) — **not** the
structured `TranscriptView`/`reduceStreamEvent` component REQ-4 built for
claude sessions, since there are no structured events to feed it. If/when
1091 adds a claude-invoking non-track dispatch, structured transcripts for
*that* case can revisit REQ-1-3's mechanism then, against a real target —
don't build the generalized `dispatchId` plumbing speculatively ahead of
having anything real to verify it against (see plan.md Phase 6's own note
on why the first attempt at this failed unverified).

~~Original (wrong) text: "Not every run is track-scoped: 1085's `deploy`
and 1091's `create-project` dispatches (`worker_dispatch.track_number IS
NULL`) have no track detail panel to show a drawer on. REQ-1-3's
stream-json/log/WS mechanism is unaffected — the source of truth is still
the JSONL log file, still pushed the same way — this just generalizes
*what the transcript is keyed by*: `track_number` for track-scoped runs,
`worker_dispatch.id` for everything else. Clicking a non-track-scoped
worker's activity snippet (REQ-5) opens the same transcript-rendering
component (REQ-4's renderer, reused) in a standalone view keyed on the
dispatch id, rather than a track's drawer — natural home: a modal, or a
route like `/dispatch/:id`, not inside any track's UI."~~

## Acceptance Criteria

- [ ] Claude spawns produce valid stream-json JSONL in the log file
- [ ] Worker-side parsing correctly extracts text/tool_use/tool_result event
      types from the stream
- [ ] Events reach the UI over WebSocket with materially better latency than
      the old 5s tail (event-driven, not purely interval-driven)
- [ ] Track detail panel drawer auto-expands when a run starts on the viewed
      track and can be manually collapsed
- [ ] Reloading the track detail page reconstructs the transcript from the
      log file, then continues live via WS
- [ ] Non-Claude CLI runs still render correctly (raw text, no regressions)
- [ ] Workers list shows a live current-activity snippet per worker, updating
      as multiple workers run different tracks in parallel
- [ ] Clicking a worker's activity snippet opens that track's detail drawer
- [ ] A `deploy` dispatch (no track) produces a viewable raw-text log,
      keyed on the dispatch id instead of a track (see REQ-6's 2026-08-10
      correction — not a structured transcript; `create-project` deferred,
      1091 doesn't exist yet)
