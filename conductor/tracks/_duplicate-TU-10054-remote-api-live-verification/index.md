# Track TU-10054: Remote-API live verification — worker E2E + caveat removal

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Track Kind**: feature
**Author**: TU
**Created By**: test@example.com
**Merge Mode**: direct
**Summary**: Live E2E verification and caveat removal split from track 10053 (routing/deployment). Verify all acceptance criteria AC-1–AC-5 and AC-8 against the deployed cloud API, then remove remote-api caveats.

## Problem

Track 10053 ported 11 route families to the cloud function and deployed them live. The routing/deployment scope is verified (all routes reachable, returning real auth errors not SPA fallback, offline tests pass 62/62). 

The live E2E scope was deferred as a separate concern: AC-1–AC-5 (worker claiming, lane actions, session resume, dispatch pickup, two-worker race) and AC-8 (cross-workspace token rejection) require real worker spawns against production, which have real cost and are independent of the routing work. AC-9 (caveat removal) depends on the rest passing.

This track verifies that live scope and removes the caveats.

## Solution

1. Create two fixture workspaces in production (scoped, cleanly nameable)
2. Register a real worker against the cloud API for each
3. Drive a real lane action through each to verify claim/lock/session semantics
4. Verify session resume with `--resume` across a second lane action
5. Create a manual dispatch in the UI and verify worker pickup
6. Run a two-worker race claim on a single track
7. Verify cross-workspace token rejection
8. Remove 10052 caveats from App.jsx, bin/lc.mjs, SKILL.md, product.md

## Acceptance Criteria

- [ ] AC-1: With a worker configured for `remote-api` against the deployed
      cloud API, `lc worker start` claims a queued track and the track moves to
      `running` — observed on the cloud board, not inferred from logs.
- [ ] AC-2: That same worker completes a lane action end to end (claim → lock →
      run → unlock → lane transition) against the cloud API, and the resulting
      lane change is visible in the cloud UI.
- [ ] AC-3: A second lane action on the same track resumes the same Claude
      session — `GET /track/:num/session` returns the id stored by the first
      action, and the worker's spawn line contains `--resume <that id>`.
- [ ] AC-4: A manual dispatch created in the cloud UI is picked up by the cloud
      worker (it appears in `GET /worker/:id/dispatch`, transitions to
      `claimed`, then reports `done`), and the UI shows the outcome.
- [ ] AC-5: Two workers pointed at the same cloud project and the same single
      queued track result in exactly one claim — verified by both workers'
      claim responses, not by reading the code.
- [ ] AC-8: A worker whose `X-Worker-Token` belongs to another workspace's
      worker is rejected; it cannot read that worker's dispatch inbox or claim
      that workspace's tracks.
- [ ] AC-9: No caveat text about `remote-api` being unsupported remains in
      `ui/src/App.jsx`, `bin/lc.mjs`, `SKILL.md`, or `conductor/product.md` —
      and each removal is justified by an observation recorded under AC-1–AC-5.

## Notes

- Fixture workspaces can be created directly in production DB (they're just rows in `workspaces` + `api_tokens` with clear naming like `test-fixture-worker-*`)
- Cleanup: fixture workspaces left behind are harmless but should be documented or soft-deleted if the track is re-run
- Cross-workspace rejection (AC-8) requires two fixture workspaces with different workspace_ids
