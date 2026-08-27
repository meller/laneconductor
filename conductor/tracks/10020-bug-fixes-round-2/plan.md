# Track 10020: Bug fixes round 2

**Problem**: `reconcileOrphanedDispatches()` runs exactly once per worker process (gated by
`hasReconciledOrphanedDispatches`, `laneconductor.sync.mjs:1043`). A dispatch orphaned *mid-run* —
worker replaced while its `detached` CLI child keeps running — is therefore never noticed by
anything: the child's exit handler died with the old process, and the one-time check already ran
and found nothing. The dispatch, `tracks.lane_action_status`, and the primary's `index.md` stay
frozen forever (live: track 10018, dispatch 1588, stuck 5+ min at `quality-gate:queue` with a
finished, committed worktree).

**Solution**: Make orphan reconciliation periodic, and give it a liveness signal that survives a
worker restart — a persistent per-track run marker holding the spawned CLI's pid — so it can tell
"finished while orphaned" (close it out) from "still running while orphaned" (leave it alone) from
"died without recording an outcome" (fail it and flag a human).

See `spec.md` for the full requirement list. Phases are ordered so the liveness primitive exists
before anything depends on it.

---

## Phase 1: Persistent run marker

**Problem**: `runningTrackMap` is the only authoritative "is this CLI still alive" signal, and it
is in-memory — worthless for exactly the orphan case, where the process holding it is gone.
**Solution**: Mirror it to disk at spawn time so any later process can ask the OS.

- [ ] Task 1: Create `conductor/services/run-marker.mjs` (pure, no I/O — mirrors
      `workspace-mode.mjs` / `orphaned-dispatch.mjs` extraction style):
    - [ ] `runMarkerPath(primaryRoot, trackNumber)` → `<root>/conductor/.runs/<track>.json`
    - [ ] `buildRunMarker({ pid, pgid, workerPid, trackNumber, dispatchId, action, command, now })`
    - [ ] `parseRunMarker(json)` — tolerant: returns `null` on malformed/partial JSON rather than
          throwing (a corrupt marker must never take the reconcile loop down)
    - [ ] `isRunMarkerLive(marker, { isPidAlive, readProcessCommand })` → `{ live, reason }`,
          implementing REQ-2: pid alive **and** the live process's command still matches the
          recorded `command`; unreadable command ⇒ not live (never block forever)
- [ ] Task 2: Wire writes into `spawnCli` (`laneconductor.sync.mjs`, alongside
      `runningTrackMap.set(proc.pid, trackNumber)` at ~`:4675`) — write the marker to
      `process.cwd()` (the primary checkout, same base `conductor/logs/` uses), *not* `worktreePath`.
      Thread `dispatchId`/`action` in from the caller; default `null` for auto-launch/chat spawns.
- [ ] Task 3: Remove the marker in `proc.on('exit')` (~`:4686`), unconditionally and best-effort
      (`try/catch`, same shape as `releaseTrackClaim`) so a kill/crash path still clears it.
- [ ] Task 4: Add `conductor/.runs/` to `.gitignore` (next to the existing `conductor/.sync*`
      runtime entries).
- [ ] Task 5: Unit tests for the pure module — see `test.md` TC-1.1…TC-1.6.

**Impact**: New gitignored runtime artifact. No behavior change yet — nothing reads the marker
until Phase 2.

---

## Phase 2: Periodic orphan reconciliation

**Problem**: One-shot-at-startup can only ever catch dispatches that were *already* orphaned when
this process booted.
**Solution**: Its own interval, with the guards that make periodic execution safe.

- [ ] Task 1: Delete the `hasReconciledOrphanedDispatches` one-shot gate (`:240`, `:1043`); keep
      the immediate call after first successful registration (fast recovery on boot is still
      wanted). Replace the flag with an `orphanReconcileInFlight` re-entrancy guard so a slow tick
      can't overlap itself.
- [ ] Task 2: Add `setInterval(reconcileOrphanedDispatches, LC_ORPHAN_RECONCILE_POLL_MS || 30000)`
      next to the existing dispatch intervals (~`:7510-7520`), matching their documented
      test-override comment style. 30s not 5s: each tick is an HTTP GET per worker, and orphans are
      minutes-scale by nature.
- [ ] Task 3: Add the REQ-4 skip guards at the top of the per-entry loop in
      `reconcileOrphanedDispatches()`:
    - [ ] track in `new Set(runningTrackMap.values())` → skip
    - [ ] track in `activeDispatch` → skip (`reconcileActiveDispatch()` stays the sole finalizer
          for this process's own dispatches — prevents two conflicting outcome PATCHes)
    - [ ] `entry.claimed_at` younger than `LC_ORPHAN_RECONCILE_GRACE_MS || 30000` → skip (covers
          claim → lock → worktree → spawn, before any marker exists)
    - [ ] live run marker for the track (Phase 1's `isRunMarkerLive`) → skip
    - [ ] each skip logs once per reason at `debug`/`info` via `logger`, not `console.warn` spam
          every 30s
- [ ] Task 4: Implement the two injectable probes used by `isRunMarkerLive`: `isPidAlive(pid)` via
      `process.kill(pid, 0)` (`ESRCH` ⇒ false, `EPERM` ⇒ true — the process exists, just isn't
      ours) and `readProcessCommand(pid)` via `ps -p <pid> -o args=` (`execFileSync`, short
      timeout, returns `null` on any failure).
- [ ] Task 5: Delete the stale run marker once a dispatch is reconciled, so the file doesn't
      linger and shadow a later run of the same track.
- [ ] Task 6: Tests — TC-2.1…TC-2.5.

**Impact**: A dispatch orphaned mid-run is now closed out within ≤30s of its CLI exiting, with
artifacts copied back to primary and the DB synced by the existing code path.

---

## Phase 3: Crashed-run detection

**Problem**: A CLI killed outright never writes a terminal `**Lane Status**`, so the worktree still
reads `running`, `classifyOrphanedDispatch()` returns `orphaned: false`, and the dispatch hangs in
`claimed` forever — the Phase 2 tick alone doesn't fix this, it just re-checks it forever.
**Solution**: Once the marker proves the process is gone, `running` on disk is no longer credible.

- [ ] Task 1: Extend `classifyOrphanedDispatch({ ..., runnerExited })` in
      `conductor/services/orphaned-dispatch.mjs`: when `runnerExited === true` **and** the status is
      `running`, return `{ orphaned: true, status: 'failed', skipArtifactCopy: true,
      flagForHuman: true, result: <"CLI exited without recording an outcome — re-run <action>"> }`.
      When `runnerExited` is undefined/false, behavior is **byte-identical to today** (REQ-6).
- [ ] Task 2: Pass `runnerExited` from `reconcileOrphanedDispatches()` — `true` only when a marker
      existed and was proven not-live; never for the no-marker case.
- [ ] Task 3: Confirm the existing `flagForHuman` branch posts the `⚠️` conversation comment for
      this new case too, and word it for a crash rather than a lane/action mismatch (reuse the
      existing `appendFileSync` block; branch the message on the classification).
- [ ] Task 4: Tests — TC-3.1…TC-3.4.

**Impact**: The "stuck at running forever after a crash" state becomes self-healing and visible in
the Inbox instead of silent.

---

## Phase 4: End-to-end regression tests

**Problem**: Every bug in this track is a *timing* bug across a process restart; unit tests on the
pure modules cannot show the real thing works.
**Solution**: Drive it with the real worker + mock collector harness already used by
`track-10020-reconcile-premature-finalize.test.mjs`.

- [ ] Task 1: `conductor/tests/track-10020-orphan-reconcile-periodic.test.mjs` — full incident
      replay (TC-4.1): worker A claims a dispatch and spawns a slow `mock-cli.mjs`; kill worker A
      only (child survives); start worker B on the same worker number; assert the dispatch is
      **still** `claimed` while the child runs, then let the child finish (writing
      `Lane: done` / `Lane Status: success` into the worktree's `index.md`) and assert worker B
      finalizes it: dispatch `done`, artifacts copied to primary, `lane_action_status` pushed.
- [ ] Task 2: TC-4.2 in the same file — the premature-finalize half: while the orphaned child runs,
      flip the worktree's `Lane Status` to a transient non-`running` value across several ticks and
      assert the dispatch stays `claimed`.
- [ ] Task 3: TC-4.3 — SIGKILL the orphaned child and assert Phase 3's failed + `⚠️` comment
      outcome.
- [ ] Task 4: `conductor/tests/track-10020-dispatch-running-patch.test.mjs` (REQ-7) — pin commit
      `0abfcf8`: dispatching a lane action PATCHes `lane_action_status: 'running'` to the collector
      at spawn.
- [ ] Task 5: Run the full existing suite (`node --test conductor/tests/`) and confirm no
      regressions, particularly `track-10020-*`, `track-1110-*`, `track-1117-*`, `local-api-e2e`,
      `auto-launch`.

**Impact**: The incident is reproducible on demand and pinned.

---

## Phase 5: Docs

- [ ] Task 1: Header comment on `run-marker.mjs` explaining *why* it exists (the in-memory
      `runningTrackMap` gap), in this file's established "explain the incident" comment style.
- [ ] Task 2: Update `reconcileOrphanedDispatches()`'s existing header comment — it currently opens
      with "runs once, right after this process's first successful registration", which becomes
      wrong in Phase 2.
- [ ] Task 3: Document `conductor/.runs/` in `conductor/product.md`'s File Roles table (owner:
      sync worker; reader: sync worker) so it isn't mistaken for a committed artifact.
- [ ] Task 4: Document `LC_ORPHAN_RECONCILE_POLL_MS` / `LC_ORPHAN_RECONCILE_GRACE_MS` inline at
      their `setInterval`, matching `LC_DISPATCH_POLL_MS`'s existing style.

**Impact**: Docs match the code; the next person doesn't re-derive why the one-shot gate went away.

---

## Notes

- **Bug 2 is already fixed** on main (`0abfcf8`, `laneconductor.sync.mjs:7386`) — this track adds
  only its regression test (Phase 4 Task 4). No implementation work.
- **Track kind**: `bug`. Workspace mode for this track is `main` (set by a human), so
  implementation runs in the primary checkout — every commit must reference `track-10020`.
