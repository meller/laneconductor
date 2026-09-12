# Tests: Track 10095 — Bounded, honest freshness for Kanban lane_action_status

## Test Commands

```bash
# Phase 1, 3, 4 — Vitest (server + component)
cd ui && npx vitest run server/tests/track-10095-claim-broadcast.test.mjs
cd ui && npx vitest run src/hooks/usePolling.test.jsx

# Phase 2 — node:test (spawns a mock collector, touches the filesystem)
node --test conductor/tests/track-10095-cli-push.test.mjs

# Full suite before the track may advance
cd ui && npx vitest run
```

> After any full `vitest run`, check `ps aux | grep laneconductor.sync.mjs` for
> leaked workers. Confirm `readlink /proc/<pid>/cwd` before treating any of them
> as a leak — one worker per project is expected.

## Test Cases

### Phase 1 — claim-queue broadcast (`ui/server/tests/track-10095-claim-broadcast.test.mjs`)
- [ ] TC-1.1: `POST /tracks/claim-queue` claiming one queued track emits exactly
      one `track:updated` — expected: payload is
      `{ projectId, trackNumber }` for the claimed track.
- [ ] TC-1.2: A call that claims nothing (no queued tracks) emits no broadcast —
      expected: zero `track:updated` events, so the idle poll stays silent.
- [ ] TC-1.3: Claiming several tracks in one call emits one broadcast per
      claimed track — expected: count equals rows returned, no duplicates.
- [ ] TC-1.4: The broadcast fires after commit — expected: a claim whose
      transaction rolls back emits nothing.

### Phase 2 — CLI immediate push (`conductor/tests/track-10095-cli-push.test.mjs`)
- [ ] TC-2.1: `lc implement <n>` in `local-api` mode sends
      `PATCH /track/<n>/action` to the mock collector — expected: body carries
      `lane_status: "implement"` and `lane_action_status: "queue"`.
- [ ] TC-2.2: `lc pulse <n> <status> <pct>` sends `progress_percent` and does
      **not** send `lane_status` — expected: `pulse` never rewrites the lane, so
      the field must be absent from the body, not null.
- [ ] TC-2.3: `local-fs` mode sends nothing — expected: the mock collector
      records zero requests, and `index.md` is still rewritten.
- [ ] TC-2.4: An unreachable collector does not break the move — expected:
      process exits 0 and `index.md` contains the new markers (AC-3).
- [ ] TC-2.5: A collector with `enabled: false` is skipped while an enabled one
      still receives the push — expected: exactly one request, to the enabled
      URL, carrying its own resolved token.
- [ ] TC-2.6: The `Authorization` header matches the token
      `getCollectorToken(cfg, idx, projectRoot)` resolves for that index —
      expected: per-collector token, not collector 0's reused.

### Phase 3 — bounded interval and staleness (`ui/src/hooks/usePolling.test.jsx`)
- [ ] TC-3.1: With the websocket connected, the poll interval is 10000ms —
      expected: advancing fake timers by 10s triggers a fetch; 30s is no longer
      the connected cadence (REQ-6).
- [ ] TC-3.2: A board that has fetched recently is not stale — expected:
      `stale === false`, and the header renders its normal label.
- [ ] TC-3.3: Once the gap since the last successful fetch passes the threshold,
      staleness flips without any new fetch — expected: `stale === true` purely
      from timer advance, proving the re-evaluation is not fetch-driven.
- [ ] TC-3.4: A successful fetch clears staleness — expected: `stale` returns to
      false and the header reads normal again.
- [ ] TC-3.5: A failed fetch does not refresh the freshness clock — expected: an
      erroring poll leaves `stale` true, since nothing current was received.

### Phase 4 — 10013 coalescing regression (`ui/src/hooks/usePolling.test.jsx`)
- [ ] TC-4.1: Ten `track:updated` messages inside one 500ms debounce window
      produce one fetch — expected: not ten (AC-6).
- [ ] TC-4.2: A message arriving while a fetch is in flight produces exactly one
      follow-up fetch via `pendingRerunRef` — expected: one, regardless of how
      many messages landed during the flight.
- [ ] TC-4.3: No fetch bypasses `fetchData` — expected: verified by reading the
      final diff; every new path routes through the existing guard (REQ-8).

## Manual Verification

Unit tests cannot show that a card moved. Both of these are required, and both
require restarting the API server and worker first — neither hot-reloads.

- [ ] MV-1 (AC-1): Open the board, let the websocket connect, queue a track, let
      the worker claim it. Expected: the card shows `running` in about a second.
      Record the observation.
- [ ] MV-2 (AC-2): Stop the sync worker. With the board open, run
      `lc implement <n>` from a terminal. Expected: the card moves within about
      a second, proving the CLI pushed it rather than a worker noticing the file.

## Acceptance Criteria
- [ ] All Phase 1-4 test cases pass, with real output recorded
- [ ] MV-1 and MV-2 observed in a real browser and written down
- [ ] `cd ui && npx vitest run` passes with no regressions
- [ ] No leaked `laneconductor.sync.mjs` workers left behind
