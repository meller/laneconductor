# Track TU-10053: Port missing worker routes to the cloud function

**Lane**: done
**Lane Status**: queue
**Progress**: 100%
**Last Run**: claude/claude-haiku-4-5-20251001 (primary)
**Phase**: Phases 1-4 done; Phase 5 blocked on production-deploy authorization
**Type**: dev
**Track Kind**: feature
**Author**: TU
**Created By**: test@example.com
**Merge Mode**: direct
**Waiting for reply**: yes
**Summary**: Eleven route families the sync worker depends on exist in ui/server/index.mjs but are missing from cloud/functions/index.js. Porting them also requires worker identity in cloud auth, a transaction primitive, and one Atlas migration — see spec.md.

## Problem

Track 10052 fixed `firebase.json`'s rewrite globs, so API paths now reach the
`api` cloud function instead of falling through to the SPA. That is necessary
but not sufficient for `remote-api` mode: the function does not implement
several routes `conductor/laneconductor.sync.mjs` calls on every cycle.

Re-audited 2026-09-03 during planning — present in `ui/server/index.mjs`,
absent from `cloud/functions/index.js`, and actually called by the worker:

| Route family | cloud | local | Worker use |
|---|---|---|---|
| `GET /projects/:id/workflow` | ❌ | ✅ | per-project workflow.json fetch |
| `POST /conductor-files` | ❌ | ✅ | **(new)** pushes conductor/ content to DB |
| `GET /track/:num` | ❌ | ✅ | **(new)** track + comments read-back |
| `POST /track/:num/lock` / `/unlock` | ❌ | ✅ | git lock coordination |
| `POST /track/:num/prespawn-block` (+ `/reset`) | ❌ | ✅ | pre-spawn guard |
| `GET`/`POST`/`DELETE /track/:num/session` | ❌ | ✅ | session continuity (`--resume`) |
| `POST /tracks/claim-queue` | ❌ | ✅ | queue claim |
| `GET /worker/:id/dispatch` | ❌ | ✅ | **(new)** dispatch inbox — the read half |
| `GET /worker/:id/dispatch/claimed` | ❌ | ✅ | **(new)** orphan reconciliation |
| `PATCH /worker-dispatch/:id` | ❌ | ✅ | dispatch outcome report |
| `GET /api/projects/:id/claimable-tracks` | ❌ | ✅ | auto-launch claim candidates |

Four families marked **(new)** were missed by this track's original audit. The
original listed only `/worker-dispatch/:id` — the *write* half of the dispatch
inbox; porting that alone would leave a cloud worker unable to read its own
inbox, the only thing a sync-only worker ever does.

**Not in scope — already in the cloud function** (verified): `POST
/worker/register`, `PATCH /worker/heartbeat`, `POST /track`, `PATCH
/track/:num/action`, `/lane`, `/block`, `POST /track/:num/comment`, `GET
/track/:num/retry-count`, `POST /tracks/heartbeat`, `GET /tracks/stale`, `POST
/tracks/reset-stuck-actions`, `/provider-status`, `/project/ensure`,
`/file-sync/*`, `DELETE /worker`. Registration works today; what fails is
everything after it. See spec.md for the full excluded list, including four
UI-only routes deliberately not ported.

The audit above is a route-presence check, and presence is not contract
equivalence — planning found three structural blockers a copy-paste port would
hit (detailed in spec.md):

1. Cloud `auth` never resolves `req.worker_id`, so `/track/:num/session` could
   only ever return `400` and claims would record a null owner.
2. The cloud function has no transaction primitive, so `FOR UPDATE SKIP LOCKED`
   would run across pooled connections and permit double-claims.
3. The four `prespawn_block_*` columns live only in `ui/server/migrations/`,
   which **has no runner** — they are absent from the cloud DB.

Plus one routing gap 10052 left: `/conductor-files` has no rewrite in
`firebase.json` at all.

This is the same class of gap track 1046 closed for `/api/keys`.

## Solution

Port the handlers to `cloud/functions/index.js` matching the local contract,
after first landing the prerequisites: `X-Worker-Token` worker identity in both
cloud `auth` and local `collectorAuth`, a `withTransaction` helper, one Atlas
migration, and the `/conductor-files` rewrite. Verify live against the deployed
API, then remove the 10052 caveats from `ui/src/App.jsx`, `bin/lc.mjs`,
`SKILL.md`, and `conductor/product.md`.

(`ui/src/components/AccountPanel.jsx`, named in the original problem statement,
does not exist — the App.jsx banner is the only UI caveat.)

## Acceptance

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
