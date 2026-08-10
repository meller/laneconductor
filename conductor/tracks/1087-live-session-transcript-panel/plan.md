# Plan: Live Session Transcript Panel (Track 1087)

## Phase 1: Structured Worker Output

**Problem**: `claude -p` runs in default text mode — no structured events to
render live.
**Solution**: Switch claude spawns to stream-json output.

- [x] Task 1: In `buildCliArgs`'s claude branch, add `--output-format stream-json --include-partial-messages` when `cli === 'claude'`
- [x] Task 2: Confirm non-claude CLIs (`gemini`, `antigravity`) are untouched by this branch
- [x] Task 3: Verify JSONL still lands correctly in the existing `logPath` file

**✅ Phase 1 complete (2026-08-10).** Extracted the claude-specific arg
construction into `conductor/claude-cli-args.mjs` (`buildClaudeArgs`) — same
"pure module, unit-testable without spawning a process" pattern this track's
sibling (1086) used throughout, since `laneconductor.sync.mjs` runs side
effects (chokidar, `setInterval`) at import time. 6 unit tests in
`conductor/tests/claude-cli-args.test.mjs`.

**Found something the plan didn't mention, verified against the real CLI
before writing any code**: `--output-format stream-json` requires
`--verbose` when combined with `--print` — omitting it fails immediately
with `Error: When using --print, --output-format=stream-json requires
--verbose`. Added it. Also manually verified (real `claude` invocations,
not the mock): the output is valid one-JSON-object-per-line JSONL (Task 3),
and — important for not silently breaking Phase 4 of track 1086 — a
`--resume` failure's error text (`No conversation found with session ID:
...`) still appears verbatim as a raw line *and* inside the final
`{"type":"result",...,"errors":[...]}` object, so the existing
`isResumeFailure` regex match against full log content keeps working
unchanged. `buildCliArgs`'s other CLI branches (`gemini`, `antigravity`,
generic) are untouched — this only lives inside the `chosenCli === 'claude'`
branch.

## Phase 2: Event Parsing & Transport

**Problem**: Structured events exist in the log file but nothing reads or
forwards them incrementally.
**Solution**: Incremental JSONL tailing + push to collector API + WS relay.

- [ ] Task 1: Replace/extend the `tailInterval` logic to watch for file growth and parse new JSONL lines as they appear (not just every 5s)
- [ ] Task 2: New lightweight push (API endpoint or extend existing `last_log_tail` PATCH) to send structured events per track run
- [ ] Task 3: Collector API relays each event over the existing WebSocket channel (`ui/src/hooks/useWebSocket.js` server side) to clients watching that track
- [ ] Task 4: Fallback path — non-Claude CLIs continue using the current raw-tail PATCH mechanism unchanged

## Phase 3: UI — Transcript Rendering

**Problem**: No component renders a structured event stream as a transcript.
**Solution**: New rendering logic for the drawer content.

- [ ] Task 1: Parse stream-json events into renderable blocks (assistant text, tool_use, tool_result)
- [ ] Task 2: Render assistant text as chat-style blocks
- [ ] Task 3: Render tool calls as collapsible entries (tool name + input summary)
- [ ] Task 4: Fallback rendering for non-JSON lines (raw `<pre>` block) — covers non-Claude CLI runs

## Phase 4: UI — Drawer Placement & Behavior

**Problem**: No persistent, collapsible surface exists for this on the track
detail view.
**Solution**: Right-side drawer component.

- [ ] Task 1: Add collapsible right-side drawer to `TrackDetailPanel.jsx`, usable alongside spec/plan/conversation content
- [ ] Task 2: Auto-expand when a run starts on the currently-viewed track (subscribe to run-start signal over WS)
- [ ] Task 3: Manual collapse control, persists collapsed/expanded state per session (not required to persist across reloads)
- [ ] Task 4: On panel/page load, fetch + parse the full JSONL log to reconstruct history before subscribing to live WS events

## Phase 5: UI — Cross-Worker Activity View

**Problem**: A developer can have several of their own workers registered to
a project (`workers.user_uid`, track 1084), and several can run different
tracks in parallel — nothing surfaces that at a glance without opening each
track individually.
**Solution**: Live current-activity snippet per worker in `WorkersList.jsx`.

- [ ] Task 1: Subscribe `WorkersList.jsx` to the same per-track WS event stream for all tracks currently running on this project's workers
- [ ] Task 2: Show a truncated current-activity snippet per worker (last tool call or assistant text fragment)
- [ ] Task 3: Clicking a worker's snippet navigates to that track's detail view (Phase 4's drawer)

## Phase 6: Non-Track Dispatch Transcripts

**Problem**: `deploy` (1085) and `create-project` (1091) dispatches have no
associated track — no drawer to show a transcript on.
**Solution**: Generalize the transcript key from `track_number` to
`worker_dispatch.id` when there's no track; reuse Phase 3's renderer in a
standalone view instead of the track drawer.

- [ ] Task 1: Worker/API event-push path (Phase 2) keys events by `worker_dispatch.id` when `track_number` is null, in addition to the existing track-keyed path
- [ ] Task 2: Standalone transcript view (modal or `/dispatch/:id` route) reusing Phase 3's rendering component
- [ ] Task 3: Non-track activity snippets (Phase 5) link to this standalone view instead of a track drawer

## Phase 7: Tests

- [ ] Task 1: Stream-json output parses correctly into expected event types (unit test against sample JSONL fixtures)
- [ ] Task 2: WS relay delivers pushed events to a subscribed client
- [ ] Task 3: Drawer auto-expands on run start, collapses on manual action
- [ ] Task 4: Non-Claude CLI run still renders via raw-text fallback with no regressions
- [ ] Task 5: Two workers running different tracks in parallel both show live activity snippets in the Workers list simultaneously
- [ ] Task 6: A `deploy`/`create-project` dispatch produces a viewable transcript keyed on the dispatch id
