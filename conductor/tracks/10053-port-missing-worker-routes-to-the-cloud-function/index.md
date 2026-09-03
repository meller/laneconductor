# Track TU-10053: Port missing worker routes to the cloud function

**Lane**: done
**Lane Status**: success
**Progress**: 0%
**Phase**: New
**Type**: dev
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
      `app.laneconductor.com` (401 counts — the route was reached; 404 does not).
- [ ] A real worker configured against the cloud URL registers, claims a track,
      and heartbeats end to end.
- [ ] Track 10052's onboarding caveats are removed only after that is observed.
**Merge Mode**: direct
**Auto Run**: yes
