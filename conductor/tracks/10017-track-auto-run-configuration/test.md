# Tests: Track 10017 — track auto run configuration

## Test Commands
```bash
# Unit: claim-scope predicate (fast, no process spawn)
node --test conductor/tests/track-10017-auto-run.test.mjs

# Server API tests (Vitest)
cd ui && npm test -- track-10017

# Integration: real worker process against local-fs tracks
node --test conductor/tests/local-fs-e2e.test.mjs

# Project-wide regression check (existing gates must still pass)
node --test conductor/tests/track-1109-claim-allowlist.test.mjs
node --test conductor/tests/local-api-e2e.test.mjs
```

## Test Cases

### Feature: `isTrackClaimable` auto-run gate (`conductor/claim-scope.mjs`)
- [x] TC-1: `autoRun: false`, no other options — returns `false` (default:
      not claimable). Negative case; without it a no-op implementation
      would still pass every other test here.
- [x] TC-2: `autoRun: true` — returns `true` (all other gates open).
- [x] TC-3: `autoRun: false, waitingForReply: true` — returns `true` (the
      bypass: a track already mid-conversation is answered regardless).
- [x] TC-4: `autoRun: false, onlyTracks` containing this track's number —
      still returns `false`. This is the case that proves `--only-tracks`
      does NOT bypass the gate (per spec.md's Design Decision) — the most
      likely place a "widen instead of narrow" regression would land.
- [x] TC-5: `autoRun: true, claimableSet` NOT containing this track — still
      returns `false` (the pre-existing assignee gate still applies;
      `autoRun` is an additional condition, not a replacement).

### Feature: FS↔DB sync of `auto_run`
- [x] TC-6: `POST /track` with `auto_run: true` on a track that doesn't yet
      exist — the inserted row has `auto_run = true`.
- [x] TC-7: `POST /track` with `auto_run` omitted, on a track whose existing
      DB row already has `auto_run = true` — the existing value is
      preserved (COALESCE), not clobbered to `false`.
- [x] TC-8: `PATCH /api/projects/:id/tracks/:num/auto-run` with
      `{ auto_run: true }` — returns `200`, updates the DB row, and (via
      `syncTrackToFile`) results in `**Auto Run**: yes` appearing in the
      track's `index.md`.

### Feature: End-to-end auto-launch gating
- [x] TC-9: A track with `**Lane**: implement`, `**Lane Status**: queue`,
      and no `**Auto Run**` marker — after one full auto-launch poll cycle
      of a real `sync+poll` worker process (`local-fs-e2e` style harness),
      no CLI process was spawned for it and `**Lane Status**` is still
      `queue` (not `running`).
- [x] TC-10: Same track with `**Auto Run**: yes` added — the next poll cycle
      spawns the CLI action and `**Lane Status**` transitions to `running`.

## Acceptance Criteria
- [x] All existing claim-scope / assignee-gate / auto-launch tests still
      pass (TC-1..10 are additive, not replacements) — **with one caveat**:
      several pre-existing E2E fixtures that create `queue`-status tracks
      needed `**Auto Run**: yes` added to keep testing what they were
      written to test (parallelism, transitions, claim races, assignee
      gating — not the new gate itself), since REQ-1's default-closed
      behavior is a deliberate breaking change for any zero-config queued
      track. Fixed: `local-fs-e2e.test.mjs`, `local-api-e2e.test.mjs`,
      `track-1084-worker-identity.test.mjs` (Phase 3 claimable-tracks),
      `track-1110-claim-race{,-api-mode}.test.mjs`,
      `track-1109-claim-allowlist.test.mjs` (base fixture),
      `ui/server/tests/track-10012-inbox.test.mjs` (param index shifted by
      the new `$28`). Two failures were investigated and confirmed
      pre-existing/unrelated (still fail with this track's changes fully
      reverted): `track-1084-worker-identity.test.mjs`'s Phase 0 pidfile
      tests, and `local-api-e2e.test.mjs`'s quality-gate-retry-exhaustion
      timing test. `brainstorm-dispatch.test.mjs` TC-1/TC-11 also confirmed
      pre-existing (fragile JSX-source-regex tests, fail identically with
      `TrackDetailPanel.jsx` reverted).
- [x] TC-1 through TC-5 pass via `node --test
      conductor/tests/track-10017-auto-run.test.mjs`.
- [x] TC-6 through TC-8 pass via the Vitest server suite.
- [x] TC-9 and TC-10 pass via a real spawned worker process, not a mocked
      simulation of the decision logic.
