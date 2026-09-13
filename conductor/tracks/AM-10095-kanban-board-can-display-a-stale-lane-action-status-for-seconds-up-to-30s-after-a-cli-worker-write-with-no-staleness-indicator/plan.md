# Track AM-10095: Bounded, honest freshness for Kanban lane_action_status

Four phases, ordered by value. Phase 1 alone removes the headline 30s window.

## Phase 1: Broadcast the worker's DB claim (RC-1, REQ-1/REQ-2)

**Problem**: `claimQueuedTracks` flips `lane_action_status` to `running` in
Postgres and never tells anyone, so a board with a healthy websocket waits out
a full `POLL_INTERVAL_CONNECTED` before the card moves.
**Solution**: Broadcast `track:updated` per claimed track once the transaction
has committed.

- [x] Task 1.1: In `ui/server/index.mjs`'s `claimQueuedTracks`, after the
      `COMMIT`, iterate the claimed rows and emit
      `broadcast('track:updated', { projectId, trackNumber })` for each.
    - [x] Emit after commit, never inside the transaction — a broadcast for a
          claim that then rolls back would push a state that never existed.
    - [x] Skip entirely when nothing was claimed (no rows), so the idle poll
          loop stays silent. (The `for` loop over an empty `r.rows` is a
          natural no-op — no separate guard needed.)
    - [x] Match the exact payload shape used by the other 32 `broadcast(` call
          sites in this file.
- [x] Task 1.2: Wrote `ui/server/tests/track-10095-claim-broadcast.test.mjs`
      covering TC-1.1 through TC-1.4 (added TC-1.4 beyond the original scope
      — an error-before-commit case — since the real-DB approach made it
      cheap and it directly proves the ordering claim in REQ-1). Follows the
      real-Postgres convention of `track-10040-claim-reason.test.mjs`, with
      `../wsBroadcast.mjs` mocked so `broadcast()` calls can be asserted
      without a real WebSocket server.
- [x] Task 1.3: Ran the test before the fix — TC-1.1 and TC-1.3 failed
      (`expected "spy" to be called 1 times, but got 0 times`), TC-1.2/1.4
      passed trivially since nothing broadcasts either way. After Task 1.1's
      edit: all 4 pass (`npx vitest run server/tests/track-10095-claim-broadcast.test.mjs`
      → `Test Files  1 passed (1)`, `Tests  4 passed (4)`). Also re-ran
      `track-10040-claim-reason.test.mjs` and `collector-endpoints.test.mjs`
      — 12/12 pass, no regression.

**Impact**: The common case — worker picks up a queued track — becomes visible
on the board in roughly the websocket round trip plus the existing 500ms
browser debounce.

## Phase 2: CLI pushes its own lane transition (RC-2, REQ-3/4/5)

**Problem**: `lc plan` / `lc implement` / `lc move` write `index.md` and rely
entirely on a separate worker process noticing the file. With no worker
running, the DB never learns.
**Solution**: Push `PATCH /track/:num/action` immediately after the existing
`writeFileSync`, best-effort.

- [x] Task 2.1: In `bin/lc.mjs`'s move-family handler, directly after
      `writeFileSync(indexPath, content)`, added the collector push.
    - [x] Gate on `cfg.mode !== 'local-fs'`.
    - [x] Filter to `(cfg.collectors || []).filter(c => c.enabled !== false)`.
    - [x] Resolve each token with the handler's existing
          `getCollectorToken(cfg, idx, projectRoot)`; set `project_id` from
          `cfg.project?.id` as a query param, exactly as the neighbouring
          session-invalidation call does.
    - [x] Send only the fields this invocation actually changed: `lane_status`
          when `lane` was set and the command is not `pulse`,
          `lane_action_status` when `status` was set, `progress_percent` when
          `prog` was set. Built via an `actionBody` object that only ever
          gains keys it actually has values for, so an omitted field is
          truly absent from the JSON body, not sent as `null`/`undefined`.
    - [x] Wrapped in `Promise.allSettled` with a per-call `.catch(() => {})` and
          an outer `try/catch`, so no failure can propagate (REQ-4).
    - [x] Documented in spec.md's Design Decisions (the comment at the call
          site references REQ-3/4/5 directly; the echo itself is covered in
          spec.md rather than repeated inline, since it's a property of the
          endpoint, not of this call site).
- [x] Task 2.2: Kept the same inline shape the session-invalidation and
      `rerun` blocks already use (load `cfg`, filter enabled collectors, map
      + `Promise.allSettled`) rather than hoisting a shared helper — the
      three blocks differ enough in body/URL/gating that a shared helper
      would need as many parameters as the inline code has lines. Neither
      existing caller's behaviour was touched.
- [x] Task 2.3: Wrote `conductor/tests/track-10095-cli-push.test.mjs` against
      a mock collector (extended `mock-collector.mjs` with an `actionCalls`
      log, following the existing `sessionDeletes` convention, so a test can
      assert on an individual push's shape/token rather than only the
      merged end state), covering TC-2.1 through TC-2.6 (added TC-2.6 beyond
      the original scope — per-collector token verification — since the
      `actionCalls` log made it cheap and REQ-5 explicitly calls out
      per-collector token resolution). `node:test`, per the repo rule for
      anything spawning a real process.
- [x] Task 2.4: Ran it against the pre-fix code first (temporarily
      reverted `bin/lc.mjs` to the last commit) — 4 of 6 failed
      (`0 !== 1` on `state.actionCalls.length`); TC-2.3 (local-fs) and
      TC-2.4 (unreachable collector) passed trivially since both expect
      zero-push/non-blocking behaviour either way. Restored the fix — all
      6 pass (`node --test conductor/tests/track-10095-cli-push.test.mjs`
      → `# pass 6`, `# fail 0`). Also re-ran
      `track-10092-move-family-cli.test.mjs` (shares the same handler and
      the extended mock collector) — 15/15 pass, no regression. Checked
      `ps aux | grep mock-collector` afterwards — no new orphans from this
      run (one pre-existing leaked process from an earlier track-10075
      session was present but unrelated).

**Impact**: A CLI-driven transition reaches the DB without a worker in the
loop, and a down collector still cannot break the CLI.

## Phase 3: Bound the blind window and make the indicator honest (RC-3, REQ-6/REQ-7)

**Problem**: `POLL_INTERVAL_CONNECTED = 30000` sets the worst case, and the
header reads "updated 1s ago" throughout it.
**Solution**: Lower the ceiling, and give the indicator a stale state.

- [x] Task 3.1: In `ui/src/hooks/usePolling.js`, changed
      `POLL_INTERVAL_CONNECTED` from `30000` to `10000` (REQ-6). Left
      `POLL_INTERVAL_DEFAULT` at 2000.
- [x] Task 3.2: Derived and returned a `stale` boolean from `lastUpdated` —
      true once the gap since the last successful fetch exceeds
      `STALE_THRESHOLD_MS` (20000ms — 2x `POLL_INTERVAL_CONNECTED`), so a
      healthy board never flickers into the stale state between two
      ordinary polls.
    - [x] Re-evaluated on its own 1s `setInterval`, not only on fetch — a
          board that has stopped fetching will never re-render on its own,
          which is exactly when the signal matters. Proven by TC-3.3, which
          advances time with every fetch deliberately failing and still
          observes `stale` flip to true.
    - [x] `fetchData`, `inFlightRef`, and `pendingRerunRef` untouched — the
          stale-tracking effect is a fully separate `useEffect`/`useState`
          pair (REQ-8).
- [x] Task 3.3: In `ui/src/App.jsx`'s header indicator, added a `stale`
      branch between the existing `error` and normal branches — amber dot +
      "stale — last update Xs ago" text, same dot+text DOM shape as the
      normal branch so only color/copy changes. `connecting…` and DB-error
      branches untouched. Verified with `npx vite build` (clean build, no
      new warnings).
- [x] Task 3.4: Wrote `ui/src/hooks/usePolling.test.jsx` — TC-3.1 through
      TC-3.5 (added TC-3.4/3.5 beyond the original scope: "a successful
      fetch clears staleness" and "a failed fetch does not refresh the
      clock" are the natural complements to TC-3.3 and cost nothing extra
      once the harness existed), using `vi.useFakeTimers()` +
      `renderHook`/`act` from `@testing-library/react`, with `useWebSocket`
      and `AuthContext` mocked so the hook can be driven deterministically
      without a real socket or auth flow.

**Impact**: Worst case drops from 30s to 10s, and past that the board says so.

## Phase 4: Regression guard for the 10013 coalescing (REQ-8)

**Problem**: Phase 1 makes broadcasts more frequent. Track 10013 added
`inFlightRef` / `pendingRerunRef` specifically to stop a double-fetch/abort
storm, and more broadcasts is the exact pressure that guard exists to absorb.
**Solution**: Prove it still holds under the new broadcast rate.

- [x] Task 4.1: Added TC-4.1 to `ui/src/hooks/usePolling.test.jsx` (written
      alongside Task 3.4, same file/session) — fires 10 `track:updated`
      messages inside one debounce window; asserts the resulting fetch
      count increases by exactly one cycle's worth (4 parallel `fetch()`
      calls for a `projectId: null` board), not ten.
- [x] Task 4.2: Added TC-4.2 — two WS bursts land in separate debounce
      windows while the first round's `fetch()` calls are deliberately left
      unresolved (simulating a slow network round trip, the exact track
      10013 scenario); several more messages arrive during the same
      in-flight window. Asserts no new `fetch()` calls are issued until the
      in-flight round resolves, at which point exactly one follow-up round
      fires — not one per message.
- [x] Task 4.3: Read the final diff (`git diff ui/src/`) — the only browser-
      side changes are inside `usePolling.js` (constants + the new,
      independent stale-tracking effect) and `App.jsx` (render-only, no new
      `fetch(` calls). No new call site bypasses `fetchData`/`inFlightRef`.

**Impact**: The coalescing fix is pinned by tests instead of by convention.

## Verification (run before any phase is marked complete)

- [x] `cd ui && npx vitest run` — full suite: 15 files / 39 tests fail, both
      with and without this change (confirmed by reverting Phase 3's two
      files and re-running the identical suite) — pre-existing,
      unrelated (`WorkflowSettings.test.jsx` react-flow rendering). This
      change adds exactly 7 new passing tests and 0 new failures.
- [x] `ps aux | grep laneconductor.sync.mjs` after every full run in this
      track — only ever showed the 4 pre-existing real per-project workers
      (matches repo memory: one-per-project is normal), never a new one.
- [x] `node --test conductor/tests/track-10095-cli-push.test.mjs
      conductor/tests/track-10092-move-family-cli.test.mjs` — 21/21 pass.
- [x] Restarted the API server for manual verification — see below; ran a
      freshly started server against this worktree's own patched code, not
      a stale process.
- [x] Drove AC-1 and AC-2 for real — not in the browser UI itself (see note
      below), but against a real running patched API server, a real
      Postgres row, and a real WebSocket client, which is the exact
      end-to-end signal path the browser UI consumes. Isolated from the
      user's live primary instance throughout: dedicated throwaway
      project (id 73858, deleted afterward), alternate API port (18091,
      the live primary's 8091 untouched), disposable sandbox repo under
      `/tmp` (deleted afterward). No process was left running afterward
      (`ps aux` confirmed only the 4 pre-existing real workers remained).

  **AC-2 (CLI push, no worker running) — observed live:**
  Confirmed zero workers running for the sandbox project, then ran
  `lc pulse 9001 running 42` from the sandbox directory against the
  patched collector. A WebSocket client connected directly to the patched
  server received `{"event":"track:updated","data":{"projectId":73858,
  "trackNumber":"9001"}}` **56ms** after the CLI command was invoked — with
  no worker process anywhere near this project. `GET /track/9001` then
  confirmed `lane_action_status: "running"`, `progress_percent: 42`,
  `lane_status` unchanged at `"implement"` (pulse correctly never rewrites
  Lane, per TC-2.2). Before this track, this would never have reached the
  DB at all without a worker running.

  **AC-1 (claim broadcasts) — observed live:**
  Set track 9001 back to `lane_status: implement`, `lane_action_status:
  queue`, then called `POST /tracks/claim-queue` — the exact endpoint the
  worker's own claim loop calls — with a fresh WebSocket client already
  connected. The broadcast arrived **13ms** after the claim call. Before
  this track's Phase 1 fix, this endpoint never broadcast at all, so a
  connected board would have waited for its next scheduled poll (up to
  `POLL_INTERVAL_CONNECTED`).

  **What this does not cover:** the actual browser rendering the amber
  "stale" indicator or the card animating in `KanbanBoard.jsx` was not
  observed in a real browser tab. `ui/src/hooks/useWebSocket.js` hardcodes
  its target port to `8091` with no override — the live primary API
  server's own port — so pointing a real browser's WebSocket at the
  patched server without either colliding with the live primary or
  patching unrelated code was not possible without briefly stopping the
  user's live local API server — not done unattended without asking
  first. The `usePolling.test.jsx` suite (Phase 3/4, 7
  tests) covers the exact same interval/staleness/coalescing logic the
  browser would exercise, using the same hook, with fake timers standing
  in for real elapsed time — combined with the two live end-to-end
  observations above, this is high-confidence but not a substitute for a
  human clicking through the actual board. Flagged for the user rather
  than silently claimed as done.
## ✅ COMPLETE

All 4 phases implemented, tested, and verified — see Verification section above.

## ✅ REVIEWED

Code review complete — all phases pass verification. All acceptance criteria met. No regressions introduced. Ready for quality-gate.
