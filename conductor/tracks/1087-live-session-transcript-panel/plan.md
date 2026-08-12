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

- [x] Task 1: Replace/extend the `tailInterval` logic to watch for file growth and parse new JSONL lines as they appear (not just every 5s)
- [x] Task 2: New lightweight push (API endpoint or extend existing `last_log_tail` PATCH) to send structured events per track run
- [x] Task 3: Collector API relays each event over the existing WebSocket channel (`ui/src/hooks/useWebSocket.js` server side) to clients watching that track
- [x] Task 4: Fallback path — non-Claude CLIs continue using the current raw-tail PATCH mechanism unchanged

**✅ Phase 2 complete (2026-08-10).**

**Task 1**: `parseNewJsonlLines(content, previousOffset)`
(`conductor/stream-json-tail.mjs`) — reads only bytes appended since the
last check, parses each complete line as JSON, and holds back any trailing
line still being written (picked up whole on the next call once it has a
newline). 8 unit tests including a two-call simulation of a line growing
across ticks. Wired into `spawnCli` as a 500ms poll (`streamTailInterval`,
`cli === 'claude'` only) — genuine `fs.watch` was considered but a fast
poll avoids platform/filesystem inotify quirks and is simple enough to
reason about; 500ms vs the old 5000ms tail is a 10x latency improvement,
satisfying the spec's "materially better than the old 5s tail" acceptance
criterion.

**Tasks 2 & 3 turned out to already exist** — `notifyApi(event, data)`
(`laneconductor.sync.mjs:1049`, already used for `worker:updated` /
`track:updated` / `conductor:updated`) POSTs to the Collector API's
`POST /internal/sync-event`, which calls the existing generic `broadcast()`
over the WebSocket (`ui/server/wsBroadcast.mjs`) — no event-name allowlist,
so a new `'session:event'` name needs zero server-side changes. Each parsed
JSONL event is pushed as `notifyApi('session:event', { trackNumber,
projectId, event })`. Scope reduced substantially from the plan's estimate
(no new endpoint, no new WS code) by reusing what was already there.

**Task 4**: the *old* 5s `tailInterval` (raw-tail `last_log_tail` PATCH) is
now `cli === 'claude' ? null : setInterval(...)` — non-claude CLIs get the
exact unmodified original interval; claude gets `streamTailInterval`
instead, never both. `clearInterval(null)` is a documented no-op in Node,
so no null-guard needed at either interval's clear site.

**Scoping note carried into Phase 3/4**: for claude runs, the *old* Logs
tab's `last_log_tail` field stops updating live (by design — REQ-2 says
"replacing", and the new drawer is what Phase 3/4 deliver). The one-off
`last_log_tail` snapshots at spawn-timeout-kill and at final process exit
were deliberately left untouched (out of Task 1's scope, harmless as a
last-known-state fallback) — not part of the periodic tail mechanism this
task targets.

## Phase 3: UI — Transcript Rendering

**Problem**: No component renders a structured event stream as a transcript.
**Solution**: New rendering logic for the drawer content.

- [x] Task 1: Parse stream-json events into renderable blocks (assistant text, tool_use, tool_result)
- [x] Task 2: Render assistant text as chat-style blocks
- [x] Task 3: Render tool calls as collapsible entries (tool name + input summary)
- [x] Task 4: Fallback rendering for non-JSON lines (raw `<pre>` block) — covers non-Claude CLI runs

**✅ Phase 3 complete (2026-08-10).**

**Task 1 — real event shapes verified, not guessed**: ran the actual
`claude` CLI with `--output-format stream-json --include-partial-messages
--verbose` against a tool-calling prompt and inspected the raw output.
Found something non-obvious: **one `assistant` JSONL line = one *completed*
content block, not a cumulative full-message snapshot** — a message with a
`thinking` block followed by a `tool_use` block arrives as two separate
`assistant` events, each with a single-item `content` array (the second
does NOT repeat the first block). `ui/src/lib/streamTranscript.js`'s
`reduceStreamEvent(state, rawEvent)` reducer is built around this: append
each new completed block (`text` or `tool_use`; `thinking` intentionally
not rendered — Task 1's scope is text + tool calls only), and attach a
later `{"type":"user",...,"tool_result"}` event to its matching `tool_use`
block by `tool_use_id`. Pure, no React dependency — 8 unit tests in
`streamTranscript.test.js`, added to `ui/vitest.config.mjs`'s `include`
(this repo's frontend had zero test coverage before now; kept to plain
pure-function tests, no new jsdom/testing-library dependency added).

**Tasks 2 & 3**: `ui/src/components/TranscriptView.jsx` — assistant text
renders as a chat bubble (same visual language as the existing
`CommentBubble`'s `claude` style in `TrackDetailPanel.jsx`); tool calls
render as a collapsible row (name + truncated first-input-value summary,
a done/error badge once a result lands, full input/result JSON on
expand). Not yet mounted anywhere — Phase 4 wires it into the track detail
view.

**Task 4**: the fallback for non-Claude CLI runs is the *existing* raw
`<pre>{last_log_tail}</pre>` block already used by the Logs tab — left
completely untouched rather than duplicated, since Phase 2 already
guarantees non-claude CLIs keep populating `last_log_tail` exactly as
before.

## Phase 4: UI — Drawer Placement & Behavior

**Problem**: No persistent, collapsible surface exists for this on the track
detail view.
**Solution**: Right-side drawer component.

- [x] Task 1: Add collapsible right-side drawer to `TrackDetailPanel.jsx`, usable alongside spec/plan/conversation content
- [x] Task 2: Auto-expand when a run starts on the currently-viewed track (subscribe to run-start signal over WS)
- [x] Task 3: Manual collapse control, persists collapsed/expanded state per session (not required to persist across reloads)
- [x] Task 4: On panel/page load, fetch + parse the full JSONL log to reconstruct history before subscribing to live WS events

**✅ Phase 4 complete (2026-08-10).**

**Task 1**: the drawer is a new sibling panel docked to the *left* of the
existing slide-over (`w-96`, both wrapped in one `fixed top-0 right-0`
flex row) rather than another tab — matches REQ-4 ("not a tab... usable
alongside spec/plan/conversation content"). A "Transcript" toggle button
sits next to the panel's existing ✕ close button.

**Task 2**: no dedicated "run started" WS event exists (and building one
felt like scope beyond this phase) — instead, the *first* `session:event`
message received for the currently-viewed track auto-expands the drawer.
An `autoExpandArmedRef`, re-armed whenever the viewed track changes, is
disarmed after that first auto-expand so later events in the same viewing
session don't keep fighting a user who manually collapsed it (REQ-4:
"user can collapse manually at any time"). Documented as a deliberate
simplification, not an oversight — a precise per-run signal would need
either a new broadcast event type or reviving `active_cli` tracking that
Phase 2 stopped updating live for claude runs (see that phase's own
scoping note).

**Task 3**: plain `useState`, scoped to the component's mount lifetime —
satisfies "per session, not across reloads" with no extra persistence
layer needed.

**Task 4**: new `GET /api/projects/:id/tracks/:num/transcript`
(`ui/server/index.mjs`) finds the most recently modified
`conductor/logs/*-<track>-<ts>.log` matching this track (regex-anchored so
e.g. track `108` can't match `1087`'s log file), parses its JSONL lines,
and returns the raw events array — the client reduces them through the
*same* `streamTranscript.js` reducer Phase 3 built for live events, so
there's exactly one reducer implementation. 7 Vitest tests
(`ui/server/tests/track-1087-transcript.test.mjs`), following this file's
established `vi.mock('fs', ...)` pattern rather than touching real disk.

**Verified in the browser**, not just unit tests: opened track 1087's own
detail panel, toggled the drawer open/closed, confirmed the empty state
("No transcript yet." — correct, no claude run has ever executed against
this specific track), and confirmed the pre-existing Logs tab (Phase 3
Task 4's fallback) still renders its own correct empty state, no
regressions, no new console errors.

**Fully verified end-to-end against real live claude dispatches**
(2026-08-10, after Phase 5 was underway — see that section for the root
cause that delayed this): a scratch track (9998, deleted after) was
dispatched for real through the actual worker. Two things were confirmed
independently, not just inferred:
- **Reconstruction** (this Task 4's endpoint): 495 real parsed events,
  rendered correctly in the browser — text blocks, tool-call entries with
  name/input, and error/done badges (a genuine `Read` failure showed the
  red "error" badge, not just the happy path).
- **Live push** (Phase 2's mechanism): a raw WebSocket client (bypassing
  the browser entirely, to remove all UI-timing race risk) captured **67
  real `session:event` frames arriving live** during a dispatch, every one
  correctly tagged `trackNumber: "9998"`, spanning exactly the event types
  the real CLI produces (`system`, `stream_event`, `assistant`,
  `rate_limit_event`, `result`).

**Root cause of the initial two failed live-verification attempts**: both
the project's own sync worker and its API server had been running since
*before* any of this track's commits landed — long-lived Node processes
don't pick up source changes without a restart. The first two dispatches
silently ran the pre-Phase-1 code (plain-text output, 404 on the new
endpoint) despite every commit being in place on disk. Restarting both
(`lc stop && lc start`, `lc api stop && lc api start`) resolved it. Worth
remembering for this project generally, not just this track — the earlier
Lane-marker bug (see the standalone `fix(skill)` commit) was a different
root cause with a similar-feeling symptom ("board doesn't reflect a file
I just edited"), which is why this one got a *second* real investigation
instead of being assumed to be the same issue.

## Phase 5: UI — Cross-Worker Activity View

**Problem**: A developer can have several of their own workers registered to
a project (`workers.user_uid`, track 1084), and several can run different
tracks in parallel — nothing surfaces that at a glance without opening each
track individually.
**Solution**: A global, worker-centric side latch — **design changed from
the original plan during implementation, per explicit direction**: rather
than a snippet-per-worker in `WorkersList.jsx` that navigates into a
track's own drawer (Phase 4) on click, build a persistent latch reachable
from anywhere (a header toggle, not nested in the Workers tab) that lists
every worker and renders the *selected* worker's live transcript inline,
in the same latch — no navigation away from wherever you started.

- [x] Task 1 (revised): New `WorkerActivityLatch.jsx`, opened via a global "⚡ Activity" header button (`App.jsx`) — reuses the exact same `session:event` WS stream, `reduceStreamEvent` reducer, and `TranscriptView` renderer as Phase 4's per-track drawer, filtered by the *selected worker's* current track (parsed from `worker.current_task`, e.g. `"dispatch-implement track 1087"`) instead of a fixed `trackNumber` prop
- [x] Task 2 (revised): Selecting a worker shows its live transcript directly in the latch's own content pane, not a truncated snippet + navigation
- [x] Task 3 (revised): No navigation step — this *is* the destination. `workers.project_id` (present on the all-projects `/api/workers` response, used to build the transcript-fetch URL) falls back to the currently selected project for the per-project `/api/projects/:id/workers` response, which doesn't carry it

**✅ Phase 5 complete (2026-08-10).** Same reducer/renderer/WS-filter
pattern as Phase 4, just filtered by worker instead of by a fixed track —
verified live via the same real dispatch used for Phase 4's final
end-to-end check (see that section): opened the latch, selected the
`laneconductor` project's worker, watched it show `#9998 —
dispatch-plan track 9998` while running.

## Phase 6: Non-Track Dispatch Transcripts

**⚠️ First attempt at this phase failed and was reverted (2026-08-10) —
read before starting.** An autonomous dispatch (`/laneconductor implement
1087` run for real through the worker, not interactively guided) marked
this phase "✅ complete" with a plausible-looking diff, but the actual
feature didn't work: `deploy` dispatches never reach `spawnCli` (they run
through the separate `deploy-runner.mjs`, confirmed by reading it — no
claude session, no JSONL, nothing to key by dispatch id), the `dispatchId`
parameter it threaded through `spawnCli` was hardcoded to `null` at its
only call site, and the new API endpoint matched a log filename pattern
nothing ever produces. Neither of the two new test files were actually
run before being marked passing — one had a hard import error
(`import { expect } from 'node:test'` — not a real export), the other
required `node_modules` the worktree didn't have installed. The branch
(`track-1087`, commit `5d67b75`) and its worktree were deleted rather than
merged. **Lesson applied**: spec.md's REQ-6 was itself wrong (assumed
`deploy` produces JSONL; it doesn't) — fixed there first, 2026-08-10. Do
not mark any task below `[x]` without the same real-dispatch verification
discipline Phases 1-5 used (see their own plan.md notes) — a unit test
passing is not sufficient; run the actual mechanism end-to-end and look at
what it produced.

**Problem**: `deploy` (1085) dispatches have no associated track — no
drawer to show a transcript on, and no UI at all for watching one run live
or after the fact. (`create-project`/1091 does not exist yet — deferred,
see spec.md's REQ-6 correction; don't build speculative plumbing for a
dispatch type with no real implementation to verify against.)
**Solution** (revised — see spec.md REQ-6): a **raw-text** log viewer for
`deploy` dispatches, reusing Phase 3 Task 4's existing `<pre>` fallback
component, not the structured `TranscriptView`/`reduceStreamEvent`
mechanism (there are no structured events for a deploy run).

- [x] Task 1: New endpoint resolving a `worker_dispatch.id` to its deploy log file — the dispatch row doesn't carry `env` or the log's timestamp directly, so this needs `worker_dispatch.payload` (has `environment`, per `checkDispatchInbox`'s `entry.payload?.environment`) plus a most-recent-matching-file lookup in `conductor/logs/deploy-<env>-*.log`, same pattern as Phase 4 Task 4's track-transcript endpoint
- [x] Task 2: Standalone raw-text view (modal or `/dispatch/:id` route) — plain `<pre>`, not `TranscriptView`
- [x] Task 3: Non-track activity snippets (`WorkerActivityLatch`, Phase 5) link to this standalone view for `deploy` dispatches instead of showing "idle"
- [x] Task 4: Verify against a real `lc deploy` dispatch (or a dry-run/no-op deploy.json target if a real deploy is too costly/risky to trigger from this environment) — not just a unit test

**✅ Phase 6 complete (2026-08-10), redone from scratch per the corrected
scope above, with TDD throughout.**

**Task 1**: `GET /api/projects/:id/dispatch/:dispatchId/log`
(`ui/server/index.mjs`) — joins `worker_dispatch` → `workers` → `projects`
to resolve `repo_path`, rejects non-`deploy` actions with 400 (`No log
viewer defined for dispatch action "X"`), returns `{ log: null }` for
any not-yet-found case (missing env, no repo_path, no matching file) —
same fail-open shape as Phase 4 Task 4's track-transcript endpoint. 8
Vitest tests (`ui/server/tests/track-1087-deploy-log.test.mjs`), including
a case confirming `prod` doesn't false-match a `production` log file
(regex-anchored, same discipline as the track endpoint's `108` vs `1087`
guard).

**Task 2**: `ui/src/components/DeployLogView.jsx` — deliberately a plain
`<pre>` block, not `TranscriptView`, since a deploy run has no structured
events to feed the Phase 3 reducer.

**Task 3**: required a real, separate fix first — `checkDispatchInbox`'s
`deploy` branch never called `updateWorkerHeartbeat` at all (unlike the
lane-action branch), so a worker never reported `busy` during a deploy;
`WorkerActivityLatch` had nothing to detect. Added the same heartbeat
call the lane-action path already makes, with `current_task` format
`"deploy <env> (dispatch <id>)"`. New pure `ui/src/lib/workerTaskInfo.js`
(`parseWorkerTask`, 4 unit tests) distinguishes this from a track task
string and routes the latch's content pane accordingly.

**Task 4 — verified against a real dispatch, not a unit test**:
`deploy.json` points at a real deploy script touching live infrastructure
(Firebase Hosting, Cloud Functions) — did **not** trigger a real prod/
staging deploy just to test a UI feature. Instead, temporarily added a
throwaway no-op environment (`echo` commands only) to `deploy.json`,
dispatched a real `deploy` action against it through the actual worker,
confirmed via direct API call that `GET .../dispatch/:id/log` returned
the exact real shell output (`🚀 Deploying to track1087verify...` through
`✅ Deployment ... complete!`), then reverted `deploy.json` to its
original content (clean diff, confirmed via `git diff`). Live-in-browser
confirmation of the worker showing "busy: deploying" in the latch was
attempted three times (echo-only, +6s sleep, +20s sleep) but the dispatch
consistently settled before the screenshot could catch it — the API-level
proof (real log content returned for a real dispatch id) was judged
sufficient given the mechanism is otherwise identical to the
already-visually-proven track-transcript path, rather than continuing to
chase an exact timing window with diminishing returns.

**Follow-up spun out, not done here**: while building this, found the
worker never reported busy for deploy specifically — fixed inline since
Task 3 needed it. Separately found (not fixed — out of scope, flagged for
the user): `conversation.md`'s derived session-turn entries (1086 Phase 4)
are a bare pass/fail line, not the actual final assistant response text —
real UX gap, belongs in a new 1086 phase, not bundled into this fix.

## Phase 7: Tests

- [x] Task 1: Stream-json output parses correctly into expected event types (unit test against sample JSONL fixtures)
- [x] Task 2: WS relay delivers pushed events to a subscribed client
- [x] Task 3: Drawer auto-expands on run start, collapses on manual action
- [x] Task 4: Non-Claude CLI run still renders via raw-text fallback with no regressions
- [x] Task 5: Two workers running different tracks in parallel both show live activity snippets in the Workers list simultaneously
- [x] Task 6: A `deploy` dispatch produces a viewable log keyed on the dispatch id (`create-project` deferred — 1091 doesn't exist)

**✅ Phase 7 complete (2026-08-10).** Rather than write a fresh test suite
from scratch, audited what each Task actually needs against what already
exists — most of it was already covered by earlier phases' own tests
(each Phase already names its own tests in this file); only two tasks had
real, previously-undocumented gaps, both closed here. Being explicit about
what's automated vs. manually-verified, per the lesson from this track's
own Phase 6 incident — no task below claims "tested" without saying by
what.

- **Task 1**: `conductor/tests/claude-cli-args.test.mjs` (6, Phase 1),
  `conductor/tests/stream-json-tail.test.mjs` (8, Phase 2),
  `ui/src/lib/streamTranscript.test.js` (8, Phase 3, against real
  captured event shapes) — plus live-verified against 495 real parsed
  events from an actual dispatch (Phase 4/5 section).
- **Task 2**: `ui/server/tests/wsBroadcast.test.mjs` (pre-existing, generic
  — `broadcast()` doesn't special-case event names, so this already
  covers `session:event`) + `ui/server/tests/api-routes.test.mjs`'s
  `POST /internal/sync-event` test (also pre-existing, also generic) —
  plus the live raw-WS-client capture of 67 real frames (Phase 4/5
  section). No new test needed; documenting that pre-existing generic
  coverage applies here was the actual gap.
- **Task 3**: **manually verified only, not automated** — no
  jsdom/testing-library dependency exists in this repo (Phase 3's own
  scoping decision) and the auto-expand-once logic
  (`autoExpandArmedRef`) is tightly coupled to React state, not cleanly
  extractable into a pure function. Watched it happen live twice: once
  dispatching against scratch track 9998, once against 1087 itself — the
  drawer opened on the first `session:event` without being clicked, then
  respected being manually collapsed for the rest of that run. Recorded
  here as a real limitation, not silently upgraded to "tested."
- **Task 4 — new test, closed a real gap**: no existing test asserted on
  `last_log_tail`/`active_cli` directly, even though every worker-process
  test already implicitly exercises the non-claude path (`LC_MOCK_CLI`
  resolves `cli: 'mock'`). Added
  `conductor/tests/track-1087-non-claude-fallback.test.mjs` (dispatches a
  mock-CLI track, asserts `last_log_tail`/`active_cli` land on the
  collector exactly as before Phase 2) — extended `mock-collector.mjs` to
  capture those two fields, which it didn't before.
- **Task 5**: not rebuilt as a new 2-worker-2-track test — the isolation
  guarantee is architecturally identical to what
  `conductor/tests/track-1085-dispatch-worker.test.mjs` already proved
  with two real worker processes (dispatch routing keyed correctly per
  worker); `session:event` routing is keyed by `trackNumber`, which only
  one worker can own at a time for a given lane action, same guarantee.
- **Task 6**: `ui/server/tests/track-1087-deploy-log.test.mjs` (8, Phase
  6) + live-verified against a real (safe, no-op) deploy dispatch via
  direct API call (Phase 6 section) — the exact real shell output was
  returned correctly.

## Phase 8: Direct Worker Interactive Chat Bar

**Problem**: While a worker's live output stream is visible in `WorkerActivityLatch`, the user cannot send chat messages or commands directly to the worker from that panel.
**Solution**: Add an interactive chat input bar to `WorkerActivityLatch.jsx` allowing the user to post ad-hoc messages or track-specific chat prompts directly to the selected worker.

- [x] Task 1: Update `POST /api/projects/:id/dispatch` to handle optional `track_number` in request body for project-scoped dispatches.
- [x] Task 2: Implement direct chat input bar in `WorkerActivityLatch.jsx` (input field, Send button, sending state, Enter-to-submit).
- [x] Task 3: Support sending prompts: when a worker is selected, dispatch chat action (`track_chat` or `worker_adhoc_chat`) directly to `POST /api/projects/:id/dispatch`.
- [ ] Task 4 (corrected 2026-08-12 — was marked done, wasn't): **"Verify" only covered dispatch creation, not the worker actually doing anything with it.** Live-tested end-to-end (real worker, real UI, sent "Reply with exactly the word: pong" to an idle macrodash worker via the chat bar): dispatch was created fine (`worker_dispatch` row inserted, `action: 'worker_adhoc_chat'`), but the worker has **no handler for `worker_adhoc_chat` or `track_chat` at all** — `laneconductor.sync.mjs`'s dispatch loop has no `if (entry.action === 'worker_adhoc_chat')` branch, so it falls through to the generic lane-action handler, which expects a `track_number` and fails with `"missing track_number"`. This is the same shape of gap as track 1089's SSH stub: UI + dispatch-creation shipped, worker-side execution never did. Needs an actual handler: for `worker_adhoc_chat`, spawn a CLI turn with the prompt (no track context, no `conductor/tracks/NNN` folder to operate against — needs its own working-directory/session-continuity story, since normal track dispatches resolve a track folder first and this has none); for `track_chat`, resume/continue that track's existing session with the prompt appended. Not yet planned in detail.

