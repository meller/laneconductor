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

- [ ] Task 2.1: In `bin/lc.mjs`'s move-family handler, directly after
      `writeFileSync(indexPath, content)`, add the collector push.
    - [ ] Gate on `cfg.mode !== 'local-fs'`.
    - [ ] Filter to `(cfg.collectors || []).filter(c => c.enabled !== false)`.
    - [ ] Resolve each token with the handler's existing
          `getCollectorToken(cfg, idx, projectRoot)`; set `project_id` from
          `cfg.project?.id` as a query param, exactly as the neighbouring
          session-invalidation call does.
    - [ ] Send only the fields this invocation actually changed: `lane_status`
          when `lane` was set and the command is not `pulse`,
          `lane_action_status` when `status` was set, `progress_percent` when
          `prog` was set. Do not send `undefined` fields — the endpoint treats
          presence as intent to write.
    - [ ] Wrap in `Promise.allSettled` with a per-call `.catch(() => {})` and an
          outer `try/catch`, so no failure can propagate (REQ-4).
    - [ ] Comment the `syncTrackToFile` echo at the call site: the endpoint
          writes these same values back to `index.md`, which is a same-value
          write and cannot loop.
- [ ] Task 2.2: Reuse the config/collector/token block already present in this
      handler rather than re-deriving it — it is read twice already (session
      invalidation, `rerun`). Hoist to one local helper if that is cleaner, but
      do not change the behaviour of either existing caller.
- [ ] Task 2.3: Write `conductor/tests/track-10095-cli-push.test.mjs` against a
      mock collector, covering TC-2.1 through TC-2.5. Use `node:test` per the
      repo rule that anything spawning a real process or touching the
      filesystem uses `node:test`, not Vitest.
- [ ] Task 2.4: Run it and record real output.

**Impact**: A CLI-driven transition reaches the DB without a worker in the
loop, and a down collector still cannot break the CLI.

## Phase 3: Bound the blind window and make the indicator honest (RC-3, REQ-6/REQ-7)

**Problem**: `POLL_INTERVAL_CONNECTED = 30000` sets the worst case, and the
header reads "updated 1s ago" throughout it.
**Solution**: Lower the ceiling, and give the indicator a stale state.

- [ ] Task 3.1: In `ui/src/hooks/usePolling.js`, change
      `POLL_INTERVAL_CONNECTED` from `30000` to `10000` (REQ-6). Leave
      `POLL_INTERVAL_DEFAULT` at 2000.
- [ ] Task 3.2: Derive and return a `stale` boolean from `lastUpdated` — true
      once the gap since the last successful fetch exceeds a threshold set
      comfortably above the connected interval, so a healthy board never
      flickers into the stale state.
    - [ ] Re-evaluate it on a timer, not only on fetch — a board that has
          stopped fetching will never re-render on its own, which is exactly
          when the signal matters.
    - [ ] Do not touch `fetchData`, `inFlightRef`, or `pendingRerunRef`
          (REQ-8).
- [ ] Task 3.3: In `ui/src/App.jsx:562-575`, render the stale state in the
      existing indicator — change the dot and the label together so the header
      no longer reads as normal. Keep the existing `connecting…` and DB-error
      branches untouched.
- [ ] Task 3.4: Write `ui/src/hooks/usePolling.test.jsx` for TC-3.1 through
      TC-3.3, with fake timers.

**Impact**: Worst case drops from 30s to 10s, and past that the board says so.

## Phase 4: Regression guard for the 10013 coalescing (REQ-8)

**Problem**: Phase 1 makes broadcasts more frequent. Track 10013 added
`inFlightRef` / `pendingRerunRef` specifically to stop a double-fetch/abort
storm, and more broadcasts is the exact pressure that guard exists to absorb.
**Solution**: Prove it still holds under the new broadcast rate.

- [ ] Task 4.1: Add TC-4.1 to `ui/src/hooks/usePolling.test.jsx` — fire a burst
      of `track:updated` messages inside one debounce window and assert the
      resulting fetch count is collapsed, not one per message.
- [ ] Task 4.2: Add TC-4.2 — a message arriving while a fetch is in flight sets
      the pending rerun and produces exactly one follow-up fetch, not one per
      message.
- [ ] Task 4.3: Confirm by reading the final diff that every fetch still enters
      through `fetchData` and that no new call site bypasses the guard.

**Impact**: The coalescing fix is pinned by tests instead of by convention.

## Verification (run before any phase is marked complete)

- [ ] `cd ui && npx vitest run` — full suite, not just the new files.
- [ ] `ps aux | grep laneconductor.sync.mjs` afterwards. Per repo memory, a
      vitest run has leaked real workers against the primary checkout before.
      Confirm each surviving PID's `readlink /proc/<pid>/cwd` before calling
      anything a leak — one process per project is normal.
- [ ] `node --test conductor/tests/track-10095-cli-push.test.mjs`.
- [ ] Restart the API server and the worker before any manual check. Neither
      hot-reloads; verifying against a process started before the change is a
      false pass.
- [ ] Drive AC-1 and AC-2 by hand in a real browser and record what was seen.
