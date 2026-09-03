# Spec: Port missing worker routes to the cloud function

## Problem Statement

Track 10052 fixed `firebase.json`'s rewrite globs, so API paths now reach the
`api` Cloud Function instead of falling through to the SPA's `index.html`.
Routing is fixed; **the routes themselves are still missing.** A worker
configured for `remote-api` against `app.laneconductor.com` registers
successfully (`POST /worker/register` and `PATCH /worker/heartbeat` both exist
in the cloud function) and then does nothing — every call that would let it
*coordinate or claim work* 404s.

### Verified gap (re-audited 2026-09-03, this planning pass)

Presence check: `grep` for each route literal in `cloud/functions/index.js`
vs `ui/server/index.mjs`. Every row is a path `conductor/laneconductor.sync.mjs`
actually calls (extracted from the worker source, not assumed).

| Route | cloud | local | Worker use |
|---|---|---|---|
| `GET /projects/:id/workflow` | ❌ | ✅ | per-project `workflow.json` fetch |
| `POST /conductor-files` | ❌ | ✅ | pushes `conductor/` file content to the DB |
| `GET /track/:num` | ❌ | ✅ | track + comments read-back |
| `POST /track/:num/lock` / `POST /track/:num/unlock` | ❌ | ✅ | git lock coordination |
| `POST /track/:num/prespawn-block` (+ `/reset`) | ❌ | ✅ | pre-spawn guard counter |
| `GET`/`POST`/`DELETE /track/:num/session` | ❌ | ✅ | session continuity (`--resume`) |
| `POST /tracks/claim-queue` | ❌ | ✅ | queue claim |
| `GET /worker/:id/dispatch` | ❌ | ✅ | manual dispatch inbox (read) |
| `GET /worker/:id/dispatch/claimed` | ❌ | ✅ | orphaned-dispatch reconciliation |
| `PATCH /worker-dispatch/:id` | ❌ | ✅ | dispatch outcome report |
| `GET /api/projects/:id/claimable-tracks` | ❌ | ✅ | auto-launch claim candidates |

**Four families the track's original audit missed** and this pass found:
`POST /conductor-files`, `GET /track/:num`, `GET /worker/:id/dispatch`, and
`GET /worker/:id/dispatch/claimed`. The original table listed only
`/worker-dispatch/:id` (the *write* half of the dispatch inbox) — porting that
alone would leave a cloud worker unable to *read* its own inbox, which is the
only thing a sync-only worker ever does.

**Not in scope — already present in the cloud function** (verified, do not
re-port): `POST /worker/register`, `PATCH /worker/heartbeat`, `POST /track`,
`PATCH /track/:num/action`, `PATCH /track/:num/lane`, `POST /track/:num/comment`,
`GET /track/:num/retry-count`, `PATCH /track/:num/block`, `POST /tracks/heartbeat`,
`GET /tracks/stale`, `POST /tracks/reset-stuck-actions`, `GET`/`POST /provider-status`,
`POST /project/ensure`, `POST /file-sync/claim`, `PATCH /file-sync/:id`,
`DELETE /worker`, `GET /api/projects/:id/tracks`, `GET /api/workers`, `GET /api/inbox`.

**Deliberately excluded** — present in `ui/server/index.mjs`, absent from the
cloud function, and **not called by the worker or CLI** (they are UI-driven, and
the cloud UI uses the `/api/*` routes instead): `PATCH /track/:num/heartbeat`,
`PATCH /track/:num/last-comment`, `PATCH /track/:num/sync-status`,
`PATCH /track/:num/reset`. Porting them is not required for `remote-api` and is
not part of this track.

### Three blockers the presence check alone does not reveal

The original audit warned that "presence is not contract equivalence." It isn't,
and three specific structural mismatches mean this cannot be a copy-paste port.

**B1 — Worker identity is unresolvable in cloud auth.**
`cloud/functions/index.js`'s `auth` middleware resolves `req.workspace_id` from
either an `lc_` token (`api_tokens` / `api_keys`) or a Firebase ID token. It
never resolves `req.worker_id`. But `/track/:num/session` (all three verbs)
begins with `if (!req.worker_id) return res.status(400)`, and
`claimQueuedTracks` writes `claimed_by = req.machine_token` and filters by
`req.worker_visibility` / `req.worker_id`. Ported verbatim, session continuity
in the cloud can only ever return `400`, and claims would be recorded with a
null owner.

Locally, `collectorAuth` derives all of that from a `workers.machine_token`
bearer. In `remote-api` mode the worker's `resolveCollectorToken` puts
`COLLECTOR_0_TOKEN` (the `lc_` API key) **first**, ahead of the machine token it
adopted at registration — so even a cloud auth that accepted machine tokens as
bearers would never see one. This is a pre-existing gap, not a cloud-only one:
a *local* worker authenticating with an `lc_` api key hits the same
`400 worker identity required` today.

*Decision:* separate the two concerns into two headers. `Authorization: Bearer
<lc_ key>` keeps meaning "which workspace"; a new
`X-Worker-Token: <machine_token>` means "which worker". Both `auth` (cloud) and
`collectorAuth` (local) resolve `req.worker_id` / `req.worker_visibility` /
`req.machine_token` from that header when present, and the worker sends it on
every call once it has one. *Rejected alternative:* passing `worker_id` as a
query param — the local handler's own comment states worker identity must come
from the caller's credential, "never a client-supplied worker_id", and a
client-supplied id in a multi-tenant cloud is an impersonation primitive.

**B2 — The cloud function has no transaction primitive.**
It exposes a single `query(sql, params)` wrapper over `pool.query`, with pool
recreation on circuit-breaker errors. `claimQueuedTracks` requires one client
held across `BEGIN` → `SELECT … FOR UPDATE SKIP LOCKED` → `UPDATE` → `COMMIT`.
Run through `query()`, each statement may land on a different pooled connection,
which silently defeats `SKIP LOCKED` — two cloud workers could claim the same
track. A `withTransaction(fn)` helper (checkout, BEGIN, ROLLBACK-on-throw,
release) is a prerequisite, not an implementation detail.

**B3 — The `prespawn_block_*` columns are not in the cloud DB.**
This repo has **two** migration systems, and each reaches only its own
database:

- `migrations/` is applied by `scripts/migrate.sh` (`atlas migrate apply`),
  which `scripts/migrate-prod.sh` points at the cloud DB.
- `ui/server/migrations/` is applied by `runMigration()` in
  `ui/server/index.mjs`, called on **every local API server startup** (and so
  on every vitest run, which imports the app). It iterates that directory and
  swallows failures as warnings. By construction it only ever touches the
  database the *local collector* connects to — the cloud DB is served by
  `cloud/functions/index.js`, which has no equivalent.

So the four columns `/track/:num/prespawn-block` writes
(`prespawn_block_count`, `prespawn_block_kind`, `prespawn_block_reason`,
`prespawn_blocked_at`), defined only in
`ui/server/migrations/013_track_10040_prespawn_block.sql`, are present on every
developer machine and **absent from the cloud database** — confirmed by
introspecting the live cloud schema.

Everything else the ported handlers touch **is** in `migrations/` and therefore
already in the cloud DB: `track_locks`, `track_sessions` (+ `resume_count`,
`last_context_tokens`), `worker_dispatch` (+ `result`, `claimed_at`),
`worker_permissions`, `projects.conductor_files`, `projects.owner_uid`,
`tracks.claimed_by`, `tracks.locked_by`, `tracks.last_updated_by_uid`,
`tracks.assignee_uid`, `tracks.created_by_uid`, `track_comments.is_replied`.

### One routing gap remains from 10052

`/conductor-files` has **no rewrite** in `firebase.json` — neither the `app` nor
the `landing` target lists that prefix, so it falls through to the SPA
catch-all. It is also missing from `WORKER_PATHS` in
`conductor/tests/firebase-rewrites.test.mjs`, which is why 10052's suite passes
while the path is unreachable. Porting the handler without adding the rewrite
would leave it just as broken.

## Requirements

- **REQ-1** — Extend `cloud/functions/index.js`'s `auth` to resolve worker
  identity (`req.worker_id`, `req.worker_visibility`, `req.machine_token`,
  `req.worker_project_id`) from an `X-Worker-Token` header, validated against
  `workers.machine_token` **and** scoped to the authenticated workspace. A
  machine token belonging to another workspace's worker must be rejected, not
  silently ignored.
- **REQ-2** — Apply the same `X-Worker-Token` resolution to
  `ui/server/index.mjs`'s `collectorAuth`, so local and cloud resolve worker
  identity identically and a local api-key worker stops failing session calls.
- **REQ-3** — `conductor/laneconductor.sync.mjs` sends `X-Worker-Token` with its
  own machine token (from `ownMachineTokens`, or the config's for worker #1) on
  every collector call once it has one, without changing which token goes in
  `Authorization`.
- **REQ-4** — Add a `withTransaction(fn)` helper to the cloud function and use
  it for `/tracks/claim-queue`, so `FOR UPDATE SKIP LOCKED` runs on one
  connection.
- **REQ-5** — Add an **Atlas** migration (`migrations/`, not
  `ui/server/migrations/`) creating the four `tracks.prespawn_block_*` columns,
  idempotently (`ADD COLUMN IF NOT EXISTS`) so it is a no-op on a local DB that
  already has them.
- **REQ-6** — Add `/conductor-files` (bare and `/**`) to the rewrite list of
  **both** hosting targets in `firebase.json`, and to `WORKER_PATHS` in
  `conductor/tests/firebase-rewrites.test.mjs`.
- **REQ-7** — Port all 11 route families in the gap table to
  `cloud/functions/index.js`, each with: `auth`, workspace-scoped project
  resolution (`checkProject` where an `:id` param or `project_id` is available;
  an explicit workspace-scoped `SELECT` otherwise, matching the pattern
  `/worker/register` already uses), and the **same response shape and status
  codes** as the local handler — including `404` for a missing track and the
  exact `{ claude_session_id, last_context_tokens, resume_count }` null/zero
  semantics that `session-cap.mjs` depends on.
- **REQ-8** — `CLAIMABLE_LANES` must not be hand-retyped in the cloud function.
  `conductor/constants.mjs` is ESM and `cloud/functions/` is CommonJS, so a
  direct import is not available; the cloud copy must be covered by a parity
  test that fails if the two lists diverge.
- **REQ-9** — A route-parity test asserts every collector path the worker calls
  resolves to a route registered in `cloud/functions/index.js`. It must derive
  the worker's path list from `conductor/laneconductor.sync.mjs` source, not
  from a hand-maintained list, so a future worker call to an unported route
  fails the suite instead of production.
- **REQ-10** — The `remote-api` caveats added by track 10052 are removed from
  `ui/src/App.jsx`, `bin/lc.mjs`, and `.claude/skills/laneconductor/SKILL.md`
  (plus `conductor/product.md`'s "remote-api known gap" section and the
  Feature Availability footnote), **only after** REQ-11's live observation.
  Note: `ui/src/components/AccountPanel.jsx` — named in this track's original
  problem statement — **does not exist**; the App.jsx banner is the only UI
  caveat.
- **REQ-11** — Observed live against the deployed cloud API: a real worker in
  `remote-api` mode registers, fetches its project workflow, claims a queued
  track, takes and releases a git lock, stores and re-reads a session id, and
  heartbeats — with the transcript/output recorded on the track.

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
- [ ] AC-6: `node --test conductor/tests/` passes, including the route-parity
      test (REQ-9), the `CLAIMABLE_LANES` parity test (REQ-8), and the extended
      `firebase-rewrites` suite (REQ-6).
- [ ] AC-7: `cd cloud/functions && npm test` passes, with new cases covering
      each ported handler's auth rejection, `404` path, and success shape.
- [ ] AC-8: A worker whose `X-Worker-Token` belongs to another workspace's
      worker is rejected; it cannot read that worker's dispatch inbox or claim
      that workspace's tracks.
- [ ] AC-9: No caveat text about `remote-api` being unsupported remains in
      `ui/src/App.jsx`, `bin/lc.mjs`, `SKILL.md`, or `conductor/product.md` —
      and each removal is justified by an observation recorded under AC-1–AC-5.

## API Contracts

Every ported handler keeps the local response shape verbatim. The ones with
non-obvious contracts:

```
GET  /projects/:id/workflow      → the parsed workflow.json object, or {}
                                   (DB projects.conductor_files.workflow_json
                                   first; the local disk fallback is dropped —
                                   there is no repo checkout in the cloud)
POST /conductor-files            → { ok: true }
GET  /track/:num                 → { ...track, comments: [...] } | 404
POST /track/:num/lock            → { ok: true } | 404 track not found
POST /track/:num/unlock          → { ok: true }
POST /track/:num/prespawn-block  → { count, kind, reason } | 400 kind required | 404
POST /track/:num/prespawn-block/reset → { ok: true }
GET  /track/:num/session         → { claude_session_id|null,
                                     last_context_tokens|null,   ← never coerced to 0
                                     resume_count }              ← 0 when absent
POST /track/:num/session         → { ok: true } | 400
DELETE /track/:num/session       → { ok: true }
POST /tracks/claim-queue         → { tracks: [...], reason|null }
GET  /worker/:id/dispatch        → { entries: [...] }
GET  /worker/:id/dispatch/claimed→ { entries: [...] }
PATCH /worker-dispatch/:id       → { ok: true } | 400 bad status | 404
GET  /api/projects/:id/claimable-tracks → { claimable: [track_number, ...] }
```

Two deliberate cloud-side divergences, both because the cloud function has no
repo checkout: `GET /projects/:id/workflow` drops the read-from-disk fallback
(returns `{}` instead), and `GET /worker/:id/dispatch*` must additionally
verify the `:id` worker belongs to the authenticated workspace — locally there
is one tenant, so the local handler correctly does not.

## Data Model Changes

One new Atlas migration (REQ-5):

```sql
ALTER TABLE tracks
  ADD COLUMN IF NOT EXISTS prespawn_block_count  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prespawn_block_kind   TEXT,
  ADD COLUMN IF NOT EXISTS prespawn_block_reason TEXT,
  ADD COLUMN IF NOT EXISTS prespawn_blocked_at   TIMESTAMP;
```

No other schema change. The `ui/server/migrations/` vs `migrations/` split is a
real latent hazard beyond this track — flagged for its own track, not fixed
here (see Open Items).

## Open Items

- **`ui/server/migrations/` reaches only local databases.** Ten files there
  define columns the local server reads and writes, applied by
  `runMigration()` on local API startup and never to the cloud DB. Anything
  defined only there is silently cloud-missing. This track lifts the four
  columns it needs into Atlas; `tracks.merge_mode` and `tracks.workspace_mode`
  (from `009` and `010`) are confirmed missing in the cloud too but are not
  touched by any route ported here. A follow-up should reconcile the whole
  directory into `migrations/` or delete it — deliberately not in scope here,
  because auditing ten migrations for cloud-safety is a larger job than this
  port.
- **⚠️ Fundamentals conflict — `conductor/tech-stack.md` does not describe the
  cloud test layer.** Its Testing table lists three layers (node:test, Vitest,
  Playwright) with a rule that unit/integration tests with mocking use Vitest.
  `cloud/functions/` uses **jest + supertest** (`cloud/functions/package.json`,
  with an existing `test/api.test.js`), which this track extends substantially
  under REQ-7/AC-7. The conflict is pre-existing, not introduced here, and this
  track follows the existing local convention rather than rewriting the cloud
  suite. Flagged for human review: `tech-stack.md` should either document the
  cloud-function jest layer or the cloud tests should move to Vitest. Not
  modified as part of this track.
- **Cloud DB migration currency.** This plan assumes `scripts/migrate-prod.sh`
  has been applied through the latest `migrations/` entry. Phase 1 verifies
  that with `atlas migrate status` before any handler is written; if the cloud
  DB is behind, the shortfall is the first thing fixed.
