# Track TU-10053: Port missing worker routes to the cloud function

**Lane**: done
**Lane Status**: waiting
**Progress**: 0%
**Phase**: New
**Type**: dev
**Merge Mode**: direct
**Track Kind**: feature
**Author**: TU
**Created By**: test@example.com
**Summary**: Seven route families the sync worker depends on exist in ui/server/index.mjs but are missing from cloud/functions/index.js, so a worker pointed at app.laneconductor.com registers successfully and…

## Problem

Track 10052 fixed `firebase.json`'s rewrite globs, so API paths now reach the
`api` cloud function instead of falling through to the SPA. That is necessary
but not sufficient for `remote-api` mode: the function does not implement
several routes `conductor/laneconductor.sync.mjs` calls on every cycle.

Verified 2026-09-03 — present in `ui/server/index.mjs`, absent from
`cloud/functions/index.js`:

| Route family | cloud | local | Worker use |
|---|---|---|---|
| `/projects/:id/workflow` | ❌ 0 | ✅ 3 | per-project workflow.json fetch |
| `/worker-dispatch/:id` | ❌ 0 | ✅ 1 | manual dispatch inbox |
| `/api/projects/:id/claimable-tracks` | ❌ 0 | ✅ 1 | auto-launch claim candidates |
| `/tracks/claim-queue` | ❌ 0 | ✅ 1 | queue claim |
| `/track/:num/prespawn-block` (+ `/reset`) | ❌ 0 | ✅ 2 | pre-spawn guard |
| `/track/:num/session` | ❌ 0 | ✅ 3 | session continuity (`--resume`) |
| `/track/:num/lock` / `/unlock` | ❌ 0 | ✅ 1 each | git lock coordination |

**Not in scope — these already exist in the cloud function** and were verified
present, so don't re-port them: `POST /worker/register`, `PATCH
/worker/heartbeat`. Registration works today; what fails is everything after it.

The audit above is a route-presence check. Compare each handler's auth,
`checkProject` usage, and response shape against `ui/server/index.mjs` during
planning — presence is not contract equivalence.

This is the same class of gap track 1046 closed for `/api/keys`.

## Solution

Port the missing handlers to `cloud/functions/index.js`, matching the local
server's contract (auth, `checkProject`, response shapes), then re-enable the
cloud onboarding path that track 10052 caveated in `App.jsx`,
`AccountPanel.jsx`, `bin/lc.mjs`, and `SKILL.md`.

## Acceptance (to be expanded during plan)

- [ ] Every route the worker calls returns a real JSON response from
      `app.laneconductor.com` — 401/403 counts (the route was reached); a 404
      does not, and neither does a 200 whose body is the SPA's `index.html`.
- [ ] A real worker configured against the cloud URL registers, fetches its
      workflow, claims a track, takes and releases a git lock, and heartbeats
      end to end — observed, with the transcript recorded.
- [ ] A second lane action on the same track resumes the same Claude session
      (`--resume <stored id>` in the spawn line).
- [ ] A manual dispatch created in the cloud UI is picked up and reported by
      the cloud worker.
- [ ] Two workers and one queued track produce exactly one claim.
- [ ] A worker token from another workspace cannot read that workspace's
      dispatch inbox or claim its tracks.
- [ ] Track 10052's onboarding caveats are removed only after the above is
      observed.

Full criteria in `spec.md`; per-phase test cases in `test.md`.

## Phases
- [x] Phase 1: Parity harness, routing, and schema groundwork
- [x] Phase 2: Worker identity and transactions in the cloud function
- [x] Phase 3: Port the coordination and read routes
- [x] Phase 4: Port claim, session, and dispatch
- [ ] Phase 5: Live verification — **BLOCKED**: needs authorization to deploy and to migrate the cloud DB
- [ ] Phase 6: Retire the 10052 caveats — gated on Phase 5, deliberately not started

## Phase 5 outcome (2026-09-03) — partial, deliberately

Tasks 5.1 and 5.2 ran against production with real-time human authorization:

- Atlas migration applied to the cloud DB (idempotent, verified).
- `firebase deploy --only functions:api` — all 11 ported route families live.
- `firebase deploy --only hosting` — both `.firebaserc` targets had to be
  recreated from scratch; they were untracked local config.
- Reachability sweep: every ported path now returns real JSON from the Cloud
  Function instead of the SPA fallback. Independently re-verified afterwards
  with correct HTTP methods — `/worker/register`, `/tracks/claim-queue`,
  `/conductor-files`, `/track/:n`, `/provider-status` all answer
  `401 {"error":"unauthorized: missing token"}`. **Track 10052's rewrite fix
  had never actually been deployed until this run; it is now live.**

**Tasks 5.3–5.7 were NOT run.** The live worker E2E (scratch project, real
lane action, `--resume`, manual dispatch, two-worker claim race,
cross-workspace token rejection) needs two test-fixture workspaces created
directly in the production database and repeated real `claude` CLI spawns at
real cost. Both were declined in favour of splitting that work out, matching
the precedent set by `AM-1120-wizard-live-deploy-verification` (track 1119
hit the identical wall).

So this track's own deliverable — the port and the routing — is verified in
production. End-to-end worker behaviour against the cloud is not, and does
not become true by this track reaching `done`.
**Waiting for reply**: no
