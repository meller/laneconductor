# Track 10044: Board Shows `queue` While Lane Action Is Actively Running

Root cause is pinned in `spec.md` (Findings A–D). The original Phase 1 ("reproduce + pin the
root cause") was resolved by code inspection during planning; what remains of it is the
*reproduction*, which Phase 1 below keeps as failing tests written before any fix.

Phases 2–4 are independent of each other and can land in any order — each closes one of the
three defects. Phase 5 is the parity fix, Phase 6 is the real-product verification.

---

## Phase 1: Reproduce all three defects as failing tests

**Problem**: Every candidate cause is currently an argument from reading code. None of them
fails a test, so a fix cannot be proven to fix anything.
**Solution**: One failing test per finding, written and confirmed red before Phase 2 starts.

- [ ] Task 1.1: `conductor/tests/track-10044-startup-reset-liveness.test.mjs` (node:test —
      spawns real processes / touches the filesystem, per `tech-stack.md`'s rule).
    - [ ] Scaffold a temp project with two tracks, both `**Lane Status**: running`.
    - [ ] Write a live run marker for track A (`conductor/.runs/A.json`, PID of a real
          long-lived child this test controls) and a dead-PID marker for track B.
    - [ ] Start a real worker process; assert A's `index.md` still reads `running` and B's
          reads `queue`. **Currently fails on A** (Finding A).
- [ ] Task 1.2: `ui/server/tests/track-10044-immediate-reset-scope.test.mjs` (vitest +
      supertest, `describe.skipIf(!dbAvailable)` like `track-10040-claim-reason.test.mjs`).
    - [ ] Seed two `running` tracks claimed by the *same* `machine_token`.
    - [ ] `POST /tracks/reset-stuck-actions {immediate:true, exclude_track_numbers:[A]}`.
    - [ ] Assert A stays `running`, B becomes `queue`. **Currently fails** — the param does
          not exist and A is reset (Finding B).
- [ ] Task 1.3: `ui/server/tests/track-10044-heartbeat-heal.test.mjs`.
    - [ ] Seed a track at `queue`; `POST /tracks/heartbeat {track_numbers:[N], assert_running:true}`.
    - [ ] Assert the row reads `running`. **Currently fails** — the endpoint only touches rows
          already `running` (Finding C).
    - [ ] Second case: seed at `success`, same call, assert it stays `success` (AC-6).
- [ ] Task 1.4: Run all three, capture the actual red output into the task notes. A test that
      was never executed is not a reproduction.

**Impact**: Each finding becomes a checkable claim. Nothing shipped yet.

---

## Phase 2: Liveness-gated startup filesystem reset (REQ-1, REQ-5)

**Problem**: `resetFilesystemRunningStatus()` (`sync.mjs:2864`) clears every `running` marker
on the disk at startup with no liveness check.
**Solution**: Consult the run marker that `spawnCli` already writes for every spawn.

- [ ] Task 2.1: Extract the decision into `conductor/services/startup-running-reset.mjs` as a
      pure function — `shouldResetRunningMarker({ trackNumber, marker, isPidAlive })` →
      `{ reset: boolean, reason: 'no_marker'|'dead_pid'|'unparseable'|'live' }`. Same
      extraction rationale as `assert-serving-root.mjs` and `primary-cwd.mjs`:
      `laneconductor.sync.mjs` cannot be imported in a test (setInterval + chokidar at module
      load).
- [ ] Task 2.2: Rewrite `resetFilesystemRunningStatus()` to read
      `runMarkerPath(process.cwd(), trackNumber)`, parse via `parseRunMarker`, and skip when
      `isRunMarkerLive(marker)`. Reuse `run-marker.mjs` — do not re-derive PID liveness.
- [ ] Task 2.3: Replace the per-track `console.log` with one summary line naming both sets:
      tracks reset and tracks skipped-as-live (REQ-5).
- [ ] Task 2.4: Correct the stale comment at `sync.mjs:2863` — "worker owns no PIDs yet" is the
      false premise that caused this; say what is actually true (this *process* owns none; the
      *machine* may).
- [ ] Task 2.5: Unit tests for the pure function (all four reasons), plus Task 1.1 now green.

**Impact**: A worker restart, or a duplicate worker start, stops wiping live run state from
disk. Genuinely dead runs are still reset in the same pass (AC-4).

---

## Phase 3: Process-safe immediate DB reset (REQ-2, REQ-5, REQ-7)

**Problem**: `immediate:true` reset is scoped by `machine_token`, which duplicate processes of
the same worker share — so it stomps its own siblings' live claims.
**Solution**: The worker knows which tracks are live on this machine (run markers); have it say
so, and have the server exclude them.

- [ ] Task 3.1: Server — `POST /tracks/reset-stuck-actions` accepts optional
      `exclude_track_numbers: string[]`. Applies **only** to the `immediate` branch; append
      `AND track_number <> ALL($n)` to the existing WHERE. The `claimed_by = machine_token`
      scoping from track 1117 Bug 1 is untouched — this narrows, never widens (REQ-2).
- [ ] Task 3.2: Server — return the reset track numbers as it already does, and log the
      excluded ones (REQ-5).
- [ ] Task 3.3: Worker — before `resetStuckActions(true)`, scan `conductor/.runs/` for live
      markers (same `parseRunMarker`/`isRunMarkerLive` pair as Phase 2) and pass them as
      `exclude_track_numbers`.
- [ ] Task 3.4: Confirm the non-immediate 2-minute staleness sweep is untouched — it is the
      only remaining path that recovers a genuinely dead run, and Phase 2/3's guards must not
      have disabled it (REQ-7). Assert this explicitly in a test, not by inspection.
- [ ] Task 3.5: Task 1.2 now green.

**Impact**: Restarting a worker no longer sends a sibling's live track back to `queue` in the
DB. Real stuck-run recovery still works on the same 2-minute timer as before.

---

## Phase 4: Self-healing heartbeat assert (REQ-3, REQ-4)

**Problem**: The worker knows the truth every 5 seconds and has no way to tell the DB. Any
future writer that clears `running` wrongly produces the same 6-minute blind spot.
**Solution**: Make the heartbeat the safety net — narrowly.

- [ ] Task 4.1: Server — `POST /tracks/heartbeat` accepts `assert_running: boolean`. When set,
      a second UPDATE flips `lane_action_status` `'queue'` → `'running'` for the posted track
      numbers. Guarded on `lane_action_status = 'queue'` **only** — a `success`/`failure` row
      is never touched, so a run the exit handler already finalized can't be resurrected by a
      racing heartbeat (AC-6).
- [ ] Task 4.2: Server — return healed track numbers separately from `updated`, so the caller
      can distinguish "still fine" from "was broken, repaired".
- [ ] Task 4.3: Worker — pass `assert_running: true` from the 5s heartbeat
      (`sync.mjs:2882-2894`); log any healed tracks at `warn` with the track number (REQ-4).
      Deliberately `warn`, not `info`: a heal means something upstream is still broken.
- [ ] Task 4.4: Task 1.3 (both cases) now green.

**Impact**: The window between "status wrongly cleared" and "board correct again" drops from
"the rest of the run" to ≤5s, for this bug and any future one with the same shape.

---

## Phase 5: Auto-complete DB parity (REQ-6)

**Problem**: `startNextAutoCompleteStage` writes `running` to the file and never to the DB —
the gap `0abfcf8` closed for `checkDispatchInbox` and never applied here.
**Solution**: Mirror that call site exactly.

- [ ] Task 5.1: In `startNextAutoCompleteStage` (`sync.mjs:6323`), after the `writeFileSync`,
      `patch(url, token, '/track/<n>/action', { lane_action_status: 'running' })` with the same
      non-fatal `.catch(...)` logging shape as `sync.mjs:7857`.
- [ ] Task 5.2: Confirm the existing spawn-failure branch (`sync.mjs:6346`) reverts the DB too,
      not just the file — if it doesn't, add it, matching `sync.mjs:7888`.
- [ ] Task 5.3: Extend the dispatch tests to cover an auto-complete stage start.

**Impact**: "Complete & Merge" stages show `running` from spawn instead of whenever an
unrelated file sync happens to run.

---

## Phase 6: Real-product verification and full regression run

**Problem**: Every defect here is about what a human sees on a board. Unit tests cannot confirm
the board is right — this bug's whole nature is that the code "looked correct" at each site.
**Solution**: Drive the actual product, with the worker and API restarted first (they do not
hot-reload — verifying against a stale process is a false pass).

- [ ] Task 6.1: `lc worker restart` + `lc api start`, load the Kanban board.
- [ ] Task 6.2: AC-1 — dispatch a real lane action on a scratch track; watch the card read
      `running` for the whole run. Record the observation (screenshot or the real
      `/api/projects/:id/tracks` response), not a description of the code.
- [ ] Task 6.3: AC-2/AC-3 — with that run still live, start a second worker process. Confirm
      the card stays `running` and the on-disk `index.md` still reads `running`.
- [ ] Task 6.4: AC-4 — in the same startup, confirm a track with a dead run marker was reset.
- [ ] Task 6.5: AC-5 — manually set the DB row to `queue` mid-run (`psql`); confirm it returns
      to `running` within 5s and the `warn` log names it.
- [ ] Task 6.6: AC-7 — let the run finish; confirm the card leaves `running`.
- [ ] Task 6.7: Full suites: `node --test conductor/tests/` and `cd ui && npm test`. Both must
      be green, including the pre-existing `sync-concurrent-edit-grace-period`,
      `track-1102-f12-stuck-running`, and track-10020 orphan-reconcile tests, which cover
      adjacent state machinery this touches.
- [ ] Task 6.8: Update `index.md` progress and post the completion comment.

**Impact**: The acceptance criteria are confirmed against the running product, which is the
only place this bug was ever visible.


## ✅ REVIEWED

All 6 phases implemented and verified green. Full test suite passes (15/15 Track 10044 tests, 52/53 adjacent regression). All 8 acceptance criteria met. Ready for quality-gate.
