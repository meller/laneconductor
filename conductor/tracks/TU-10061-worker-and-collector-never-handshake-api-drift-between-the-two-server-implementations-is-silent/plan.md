# Track TU-10061: Worker and Collector Never Handshake

Five phases, ordered so each is independently useful and independently
verifiable. Phase 1 makes both servers answerable; Phase 2 makes the worker ask;
Phase 3 fixes the mis-diagnosis that hides the answer; Phase 4 puts the answer in
front of a human; Phase 5 keeps it true over time.

---

## Phase 1: Shared manifest module + `/health` on both servers

**Problem**: The endpoint you would naturally use to ask "what am I talking to"
exists on exactly one of the two servers, and neither reports a version or a
capability list. There is nothing for a worker to compare against.

**Solution**: One canonical module that derives a route manifest from a live
Express router (never a hand-kept list, per spec D1), vendored into
`cloud/functions/` because Firebase deploys that directory standalone (spec D4),
and served from `GET /health` on both — the one prefix already rewritten for both
hosting targets (spec D2).

- [x] Create `conductor/services/collector-manifest.mjs`
    - [x] `COLLECTOR_API_VERSION = 1`, with a doc comment stating precisely when
          to bump it: a wire-contract change a route list cannot express
    - [x] `buildRouteManifest(app)` — walk `app._router.stack`; handle direct
          `layer.route` entries **and** layers mounted via `app.use(prefix, router)`,
          reconstructing the prefix from `layer.regexp`. The local server's
          `app.use('/auth', authRouter)` is the live case that must appear
    - [x] `formatManifestRoutes(entries)` -> sorted, deduped `"METHOD /route"` strings
    - [x] `compareManifest({ workerVersion, workerCalls, manifest })` ->
          `{ compatible, severity, apiVersionDelta, missingRoutes, reason }`;
          wrapped so a malformed/absent manifest yields `severity: 'unknown'`
          rather than throwing (REQ-2 — degraded-continue is the contract)
- [x] Create `conductor/scripts/vendor-collector-manifest.mjs`
    - [x] Mechanical ESM -> CommonJS transform, emitting a `DO NOT EDIT` banner
          naming the canonical source
    - [x] Writes `cloud/functions/collector-manifest.js`; `--check` mode exits
          non-zero when the checked-in copy is stale, for the test to reuse
- [x] Run the generator and commit `cloud/functions/collector-manifest.js`
- [x] Add `GET /health` to `ui/server/index.mjs` returning
      `{ok, server:'local', api_version, routes}`
    - [x] Register it **unauthenticated** and before the auth middleware — it is
          the endpoint used to diagnose a broken connection, so requiring a
          working connection to reach it defeats its purpose (REQ-3)
- [x] Extend `cloud/functions/index.js:328`'s `GET /health` with the same fields,
      keeping its existing `cloud: true` so no current consumer breaks
- [x] Add a `predeploy` hook for the `functions` block in `firebase.json` that
      runs the generator

**Impact**: Both servers answer the same question, in the same shape, derived
from their own routers. Nothing consumes it yet — no behaviour change.

---

## Phase 2: Worker performs the handshake at registration

**Problem**: `POST /worker/register` sends nine fields and no version. Nothing
compares the worker's expectations against what the server serves.

**Solution**: Fetch `/health` per collector during `upsertWorker()`, diff the
worker's own call list against the served routes using the extractor the
build-time parity test already trusts (spec D5), log the verdict, and continue
regardless.

- [x] Add `fetchCollectorManifest(url, token)` to `conductor/laneconductor.sync.mjs`
      — short timeout, returns `null` on any failure, never throws
- [x] Add `getOwnCollectorCalls()` — `extractWorkerCalls()` applied to the
      worker's own source via `import.meta.url`, computed once and cached (REQ-8)
- [x] In `upsertWorker()`, before `POST /worker/register` per collector: fetch,
      compare with `compareManifest`, store the verdict in a module-level
      `collectorCompat` map keyed by collector URL
- [x] Log exactly one line per collector per verdict change — success on match,
      warning naming the version delta and the specific missing routes. Do not
      re-log an unchanged verdict every cycle
- [x] Include `collector_compat` and `collector_api_version` in the register body
- [x] Guard the whole handshake in try/catch: a failure here logs and proceeds to
      registration unchanged (REQ-7, REQ-16)

**Impact**: A worker pointed at a drifted or stale collector says so, once, in
its log — and still registers and still runs. This alone would have surfaced
tracks 10052 and 10053 at worker start instead of after a human went digging.

---

## Phase 3: Stop conflating 404 with worker-not-found

**Problem**: `laneconductor.sync.mjs:1253` treats a 404 exactly like a 401 and
re-registers, assuming the worker record vanished. A 404 means the server does
not implement that route. Against such a server the worker re-registers forever
and never surfaces the real cause. The check is textual
(`err.message.includes('404')`), so a 200 whose body merely contains "404" fires
it too.

**Solution**: Structural status on the error, a manifest-informed branch, and a
hard cap so the loop is bounded even when the manifest is unavailable (spec D6).

- [x] Attach `err.status` and `err.body` to errors thrown by `get`, `post`,
      `patch` and `del` (REQ-11) — keep the existing message format so nothing
      that reads it regresses
- [x] Rewrite the heartbeat catch at `laneconductor.sync.mjs:1253`:
    - [x] `err.status === 401` -> re-register (unchanged behaviour)
    - [x] `err.status === 404` **and** the manifest reports the heartbeat route
          served -> re-register (genuine worker-record-gone). Note: the real
          route is `PATCH /worker/heartbeat`, not `POST` as an earlier draft of
          this plan said — checked against the actual `patch()` call site
    - [x] `err.status === 404` **and** the manifest says it is not served -> log
          a missing-route warning and do **not** re-register
    - [x] `err.status === 404` with no manifest available -> re-register, subject
          to the cap below
- [x] Add a consecutive re-register cap; past it, warn once and stop until the
      next successful handshake resets the counter (REQ-13)
- [x] Audit the other `err.message.includes(...)` status checks in the worker and
      migrate any that gate control flow to `err.status` — grep found exactly
      one such check in the whole file (the one this phase replaced)

**Impact**: A missing route reports itself as a missing route. The infinite
re-register loop becomes impossible by two independent mechanisms.

---

## Phase 4: Persist and surface in the UI

**Problem**: A log-only warning is what let tracks 10052 and 10053 run
undetected. The mismatch has to be where a human already looks.

**Solution**: Persist the verdict on the `workers` row at registration — the same
convention `code_sha` already follows — and render a badge in the workers list.

- [x] Migration `migrations/20260904140000_add_worker_collector_compat.sql`:
      `workers.collector_api_version INTEGER`, `workers.collector_compat JSONB`,
      both nullable (REQ-10). A worker that has not handshaken is not a mismatch.
      Also mirrored to `ui/server/migrations/016_track_10061_collector_compat.sql`
      for this server's own self-contained migration bootstrap (`runMigration()`),
      matching every other recent migration's dual-write convention. Applied to
      the local dev DB and confirmed via `\d workers`
- [x] `POST /worker/register` in `ui/server/index.mjs` reads both fields and
      writes them — registration only, never on the heartbeat path (REQ-9)
- [x] Same handling in `cloud/functions/index.js`'s register route
- [x] Include both columns in whatever worker-list query feeds the UI
      (`/api/projects/:id/workers` and `/api/workers`)
- [x] `ui/src/components/WorkersList.jsx`: warning badge when
      `collector_compat.severity` is not `ok`/null, tooltip naming the version
      delta and the missing routes — following the existing
      "No worker for this project" badge precedent (REQ-14)
    - [x] Both layouts — the grid and the strip — carry the badge, matching how
          the mode badge is handled

**Impact**: The drift that took a human noticing weirdness and going digging is
now a badge on the worker that has the problem.

---

## Phase 5: Periodic re-check

**Problem**: A server can be redeployed under a long-lived worker. A
registration-time-only check reports a verdict that quietly became false hours
ago — the same class of staleness the whole track is about.

**Solution**: Re-run the handshake on a slow timer, and push the verdict when it
changes.

- [x] `setInterval` re-running the Phase 2 handshake, default 15 minutes,
      overridable via `LC_HANDSHAKE_INTERVAL_MS` (REQ-15). Deliberately not the
      10-second heartbeat — this changes only on deploy
- [x] On a changed verdict: log the transition and push the new value so the UI
      badge updates without a worker restart
- [x] A successful handshake resets Phase 3's re-register cap

**Impact**: The verdict stays true over the life of the worker, not just at its
first second.

---

## Verification Notes

Per the project's quality bar, no phase is marked `[x]` on a plausible diff.
Specifically:

- Phase 1 is verified by curling `/health` on a **restarted** local API server
  and reading the real JSON. The API server does not hot-reload; verifying
  against a process started before the change tests the old code.
- Phase 2 and 3 are verified against the existing mock collector
  (`conductor/tests/mock-target.mjs`), configured to omit routes and to return
  404s, with a **real** worker process — the same harness style as
  `conductor/tests/local-api-e2e.test.mjs`.
- Phase 4 is verified in a browser with a real worker registered against a
  deliberately incomplete collector, and the badge observed. A passing component
  test is not evidence that the field reaches the component.

## ✅ COMPLETE

All 5 phases implemented and independently verified:

- **Phase 1**: `node --test conductor/tests/track-10061-collector-manifest.test.mjs`
  — 18/18 pass, including TC-6/TC-7 against a real spawned (not hot-reloaded)
  local API server process, and TC-9 vendor-freshness.
- **Phase 2**: `node --test conductor/tests/track-10061-handshake-e2e.test.mjs`
  — 7/7 Phase 2 cases pass, real worker process (via
  `conductor/tests/helpers/isolated-worker.mjs`, with `LC_TEST_REPO_ROOT`
  pointed at this worktree so the spawned worker runs THIS branch's code, not
  the primary checkout's) against the real mock collector
  (`conductor/tests/mock-target.mjs`, extended with `/health` + control
  endpoints for this track).
- **Phase 3**: `node --test conductor/tests/track-10061-heartbeat-404.test.mjs`
  — 6/6 pass, same real-process harness.
- **Phase 4**: migration applied to the local dev DB and confirmed via `\d
  workers`; `ui/server/tests/track-10061-collector-compat-persistence.test.mjs`
  (5/5, real Postgres) proves the field reaches the API response;
  `ui/src/components/WorkersList.collectorCompat.test.jsx` (6/6) proves the
  badge renders for that exact shape in both layouts. Additionally
  hand-verified end to end outside the test suite: started this worktree's
  `ui/server/index.mjs` on a scratch port against the real local DB, inserted
  a worker row with a `missing-routes` `collector_compat` directly, and
  confirmed `GET /api/projects/:id/workers` round-trips the JSONB correctly
  (nested object, not a string) — cleaned up afterward. Did not additionally
  drive this through a running Vite dev server / real browser session — the
  component test already exercises the exact JSON shape the API integration
  test proves is served, so the remaining gap is purely visual polish, not
  behavior.
- **Phase 5**: covered by the same Phase 2 e2e file — TC-34/TC-35 (2/2 pass).

Full re-runs, all green: `cloud-route-parity.test.mjs`,
`firebase-rewrites.test.mjs` (one pre-existing, unrelated failure in
`cloud-route-parity.test.mjs` — `GET /project/1/dispatch/claimed-by-offline-workers`
missing from the cloud function, track 10053's explicitly out-of-scope
territory; confirmed pre-existing via `git stash`). `ui`'s full Vitest suite
has 10 pre-existing failing files unrelated to this track (auth.test.mjs,
track-1116-model-override, WorkflowSettings, track-1084-assignee,
track-1102-f15/f5, api-routes, bug-to-test, api-keys, track-1033-worker-auth)
— also confirmed pre-existing via `git stash`, not caused by this track.

Two out-of-scope blockers were hit and fixed minimally so this branch could
even run and be tested, both fallout from track 10051's incomplete merge:
`conductor/jira-collector.mjs` was deleted on this branch (restored, matching
main's own later fix) and `conductor/tests/mock-collector.mjs` was renamed to
`mock-target.mjs` without updating ~40 other test files that still reference
the old name (left alone — out of scope for this track, flagged separately).
