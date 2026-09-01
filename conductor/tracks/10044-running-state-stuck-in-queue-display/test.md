# Tests: Track 10044 — Board Shows `queue` While Lane Action Is Actively Running

## Test Commands

```bash
# Worker-side (node:test — spawns real processes, touches the filesystem)
node --test conductor/tests/track-10044-startup-reset-liveness.test.mjs
node --test conductor/tests/track-10044-run-marker-scan.test.mjs

# Server-side (vitest + supertest, needs local Postgres; skipIf(!dbAvailable))
cd ui && npx vitest run server/tests/track-10044-immediate-reset-scope.test.mjs
cd ui && npx vitest run server/tests/track-10044-heartbeat-heal.test.mjs

# Full suites (Phase 6 gate — both must be green)
node --test conductor/tests/
cd ui && npm test
```

## Test Cases

### Phase 1 — Reproduction (must be RED before any fix lands)

- [ ] TC-1: Two tracks both at `**Lane Status**: running`; track A has a live run marker
      (real child PID), track B a dead-PID marker. Start a worker.
      — expected AFTER the fix: A stays `running`, B becomes `queue`.
      — expected BEFORE the fix: **both** become `queue` (this is the reproduction).
- [ ] TC-2: Two `running` tracks sharing one `machine_token`.
      `POST /tracks/reset-stuck-actions {immediate:true, exclude_track_numbers:["A"]}`
      — expected AFTER: A `running`, B `queue`. BEFORE: both `queue` (param ignored).
- [ ] TC-3: Track at `queue`; `POST /tracks/heartbeat {track_numbers:["N"], assert_running:true}`
      — expected AFTER: row reads `running`. BEFORE: row unchanged at `queue`.
- [ ] TC-4: Each of TC-1..TC-3 executed and its red output recorded. A reproduction that was
      only reasoned about does not count.

### Phase 2 — Startup filesystem reset (REQ-1, REQ-5)

- [ ] TC-5: `shouldResetRunningMarker` with no marker file — expected: `{reset:true, reason:'no_marker'}`
- [ ] TC-6: marker with a dead PID — expected: `{reset:true, reason:'dead_pid'}`
- [ ] TC-7: malformed/truncated marker JSON — expected: `{reset:true, reason:'unparseable'}`
      (an unreadable marker must never be treated as proof of life)
- [ ] TC-8: marker with a live PID — expected: `{reset:false, reason:'live'}`
- [ ] TC-9: TC-1 green — the live track's `index.md` still reads `running` after worker start.
- [ ] TC-10: `local-fs` mode: same as TC-9 with no collector configured — the guard must not be
      gated behind a DB mode (REQ-1).
- [ ] TC-11: Startup log names both sets (reset / skipped-as-live) in one summary line.

### Phase 3 — Immediate DB reset scope (REQ-2, REQ-7)

- [ ] TC-12: TC-2 green.
- [ ] TC-13: `exclude_track_numbers` omitted — behavior byte-identical to today (no regression
      for callers that don't send it).
- [ ] TC-14: `immediate:true` with no resolvable `machine_token` — still returns `{reset:[]}`,
      i.e. track 1117 Bug 1's guard survives this change.
- [ ] TC-15: A different worker's `claimed_by` token — still not reset, exclude list or not.
- [ ] TC-16: **Non-immediate** sweep: track `running`, `last_heartbeat` older than 2 minutes,
      exclude list irrelevant — expected: still reset to `queue`. This is the regression guard
      for REQ-7 (the guards must discriminate, not disable).
- [ ] TC-17: Worker builds `exclude_track_numbers` from live markers only — a `conductor/.runs/`
      entry with a dead PID is not sent.

### Phase 4 — Heartbeat self-heal (REQ-3, REQ-4)

- [ ] TC-18: TC-3 green — `queue` → `running` within one call.
- [ ] TC-19: Row at `success`, `assert_running:true` — expected: stays `success` (AC-6).
- [ ] TC-20: Row at `failure`, same — expected: stays `failure`.
- [ ] TC-21: Row already `running` — expected: `last_heartbeat` refreshed, not reported as
      healed (healed and updated are distinct in the response).
- [ ] TC-22: `assert_running` absent/false — expected: today's behavior exactly, no flips.
- [ ] TC-23: Worker logs a `warn` naming each healed track number (REQ-4). Assert on the log
      output, not just the DB.

### Phase 5 — Auto-complete parity (REQ-6)

- [ ] TC-24: `startNextAutoCompleteStage` spawns a stage — expected: a
      `PATCH /track/<n>/action {lane_action_status:'running'}` is issued at spawn.
- [ ] TC-25: Its spawn-failure branch — expected: DB reverted to the original status, matching
      the file revert at `sync.mjs:6346`.
- [ ] TC-26: A failing DB patch does not abort the spawn (non-fatal `.catch`, same as
      `sync.mjs:7857`).

### Phase 6 — Real-product verification

- [ ] TC-27: Worker and API **restarted** before verifying (they do not hot-reload; a stale
      process yields a false pass).
- [ ] TC-28: AC-1 — card reads `running` for the full duration of a real dispatched lane
      action. Evidence: screenshot or the real `/api/projects/:id/tracks` response.
- [ ] TC-29: AC-2/AC-3 — second worker started mid-run; card and `index.md` both still
      `running`.
- [ ] TC-30: AC-4 — a dead-marker track was reset by that same startup pass.
- [ ] TC-31: AC-5 — DB forced to `queue` mid-run via `psql`; back to `running` within 5s, with
      the `warn` log line present.
- [ ] TC-32: AC-7 — run completes; card leaves `running` (no stuck-forever-running).
- [ ] TC-33: AC-8 — a "Complete & Merge" stage shows `running` from spawn.

## Acceptance Criteria

- [ ] All of TC-1..TC-33 pass, with TC-1..TC-3 confirmed red first.
- [ ] `node --test conductor/tests/` green — in particular the adjacent pre-existing suites
      this touches: `sync-concurrent-edit-grace-period`, `track-1102-f12-stuck-running`, and
      the track-10020 orphan-reconcile tests.
- [ ] `cd ui && npm test` green — in particular `track-10040-claim-reason` and
      `track-1033-worker-auth` (both exercise claim/reset SQL shapes changed by Phase 3).
- [ ] No `TODO`/`FIXME`/`not yet implemented` left in any code path this track marks `[x]`.
