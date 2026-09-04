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

- [ ] Create `conductor/services/collector-manifest.mjs`
    - [ ] `COLLECTOR_API_VERSION = 1`, with a doc comment stating precisely when
          to bump it: a wire-contract change a route list cannot express
    - [ ] `buildRouteManifest(app)` — walk `app._router.stack`; handle direct
          `layer.route` entries **and** layers mounted via `app.use(prefix, router)`,
          reconstructing the prefix from `layer.regexp`. The local server's
          `app.use('/auth', authRouter)` is the live case that must appear
    - [ ] `formatManifestRoutes(entries)` -> sorted, deduped `"METHOD /route"` strings
    - [ ] `compareManifest({ workerVersion, workerCalls, manifest })` ->
          `{ compatible, severity, apiVersionDelta, missingRoutes, reason }`;
          wrapped so a malformed/absent manifest yields `severity: 'unknown'`
          rather than throwing (REQ-2 — degraded-continue is the contract)
- [ ] Create `conductor/scripts/vendor-collector-manifest.mjs`
    - [ ] Mechanical ESM -> CommonJS transform, emitting a `DO NOT EDIT` banner
          naming the canonical source
    - [ ] Writes `cloud/functions/collector-manifest.js`; `--check` mode exits
          non-zero when the checked-in copy is stale, for the test to reuse
- [ ] Run the generator and commit `cloud/functions/collector-manifest.js`
- [ ] Add `GET /health` to `ui/server/index.mjs` returning
      `{ok, server:'local', api_version, routes}`
    - [ ] Register it **unauthenticated** and before the auth middleware — it is
          the endpoint used to diagnose a broken connection, so requiring a
          working connection to reach it defeats its purpose (REQ-3)
- [ ] Extend `cloud/functions/index.js:328`'s `GET /health` with the same fields,
      keeping its existing `cloud: true` so no current consumer breaks
- [ ] Add a `predeploy` hook for the `functions` block in `firebase.json` that
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

- [ ] Add `fetchCollectorManifest(url, token)` to `conductor/laneconductor.sync.mjs`
      — short timeout, returns `null` on any failure, never throws
- [ ] Add `getOwnCollectorCalls()` — `extractWorkerCalls()` applied to the
      worker's own source via `import.meta.url`, computed once and cached (REQ-8)
- [ ] In `upsertWorker()`, before `POST /worker/register` per collector: fetch,
      compare with `compareManifest`, store the verdict in a module-level
      `collectorCompat` map keyed by collector URL
- [ ] Log exactly one line per collector per verdict change — success on match,
      warning naming the version delta and the specific missing routes. Do not
      re-log an unchanged verdict every cycle
- [ ] Include `collector_compat` and `collector_api_version` in the register body
- [ ] Guard the whole handshake in try/catch: a failure here logs and proceeds to
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

- [ ] Attach `err.status` and `err.body` to errors thrown by `get`, `post`,
      `patch` and `del` (REQ-11) — keep the existing message format so nothing
      that reads it regresses
- [ ] Rewrite the heartbeat catch at `laneconductor.sync.mjs:1253`:
    - [ ] `err.status === 401` -> re-register (unchanged behaviour)
    - [ ] `err.status === 404` **and** the manifest reports `POST /worker/heartbeat`
          served -> re-register (genuine worker-record-gone)
    - [ ] `err.status === 404` **and** the manifest says it is not served -> log
          a missing-route warning and do **not** re-register
    - [ ] `err.status === 404` with no manifest available -> re-register, subject
          to the cap below
- [ ] Add a consecutive re-register cap; past it, warn once and stop until the
      next successful handshake resets the counter (REQ-13)
- [ ] Audit the other `err.message.includes(...)` status checks in the worker and
      migrate any that gate control flow to `err.status`

**Impact**: A missing route reports itself as a missing route. The infinite
re-register loop becomes impossible by two independent mechanisms.

---

## Phase 4: Persist and surface in the UI

**Problem**: A log-only warning is what let tracks 10052 and 10053 run
undetected. The mismatch has to be where a human already looks.

**Solution**: Persist the verdict on the `workers` row at registration — the same
convention `code_sha` already follows — and render a badge in the workers list.

- [ ] Migration `migrations/<ts>_add_worker_collector_compat.sql`:
      `workers.collector_api_version INTEGER`, `workers.collector_compat JSONB`,
      both nullable (REQ-10). A worker that has not handshaken is not a mismatch
- [ ] `POST /worker/register` in `ui/server/index.mjs` reads both fields and
      writes them — registration only, never on the heartbeat path (REQ-9)
- [ ] Same handling in `cloud/functions/index.js`'s register route
- [ ] Include both columns in whatever worker-list query feeds the UI
- [ ] `ui/src/components/WorkersList.jsx`: warning badge when
      `collector_compat.severity` is not `ok`/null, tooltip naming the version
      delta and the missing routes — following the existing
      "No worker for this project" badge precedent at lines 653-660 (REQ-14)
    - [ ] Both layouts — the grid and the strip — carry the badge, matching how
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

- [ ] `setInterval` re-running the Phase 2 handshake, default 15 minutes,
      overridable via `LC_HANDSHAKE_INTERVAL_MS` (REQ-15). Deliberately not the
      10-second heartbeat — this changes only on deploy
- [ ] On a changed verdict: log the transition and push the new value so the UI
      badge updates without a worker restart
- [ ] A successful handshake resets Phase 3's re-register cap

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
