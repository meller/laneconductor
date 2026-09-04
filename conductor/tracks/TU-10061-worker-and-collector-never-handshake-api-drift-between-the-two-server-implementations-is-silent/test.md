# Tests: Track TU-10061 — Worker and collector never handshake

## Test Commands

```bash
# Vitest suites (unit + server integration)
cd ui && npm test

# node:test suites (real processes, real filesystem)
node --test conductor/tests/track-10061-collector-manifest.test.mjs
node --test conductor/tests/track-10061-handshake-e2e.test.mjs
node --test conductor/tests/track-10061-heartbeat-404.test.mjs

# Existing suites that must not regress
node --test conductor/tests/cloud-route-parity.test.mjs
node --test conductor/tests/firebase-rewrites.test.mjs
node --test conductor/tests/collector-content-type.test.mjs
node --test conductor/tests/local-api-e2e.test.mjs

# Manual verification of the local /health route (see TC-6)
cd ui && node server/index.mjs &
curl -s localhost:8091/health | python3 -m json.tool
```

New `node:test` suites follow the project's rule: anything spawning real
processes or touching the filesystem uses `node:test`; mocked unit work uses
Vitest.

## Test Cases

### Phase 1 — Manifest module and `/health`
*File: `conductor/tests/track-10061-collector-manifest.test.mjs`*

- [ ] **TC-1**: `buildRouteManifest` on a throwaway Express 4 app with
      `app.get('/a')` and `app.post('/b/:id')` — expected: exactly those two
      entries, method upper-cased.
- [ ] **TC-2**: `buildRouteManifest` on an app with `app.use('/auth', router)`
      where the router registers `get('/config')` — expected: `GET /auth/config`
      appears. This is the case the existing static regex extractor misses, and
      the local server really does mount `/auth` this way.
- [ ] **TC-3**: `buildRouteManifest` on the **real** `ui/server/index.mjs` app —
      expected: at least 100 entries (the file registers 121 direct routes), and
      every entry has a `/`-prefixed route. A silently-empty manifest would make
      every downstream assertion vacuous, so this is asserted before it is
      trusted — same control-assertion discipline as
      `cloud-route-parity.test.mjs`'s TC-1.
- [ ] **TC-4**: `compareManifest` with worker calls fully covered — expected:
      `severity: 'ok'`, `missingRoutes: []`.
- [ ] **TC-5**: `compareManifest` with a worker call absent from the manifest —
      expected: `severity: 'missing-routes'` and that exact `METHOD /path` in
      `missingRoutes`.
- [ ] **TC-5b**: `compareManifest` with a lower collector `api_version` —
      expected: `severity: 'version-drift'`, `apiVersionDelta` negative.
- [ ] **TC-5c**: `compareManifest` given `null`, `{}`, and `{routes: 'nonsense'}`
      — expected: returns `severity: 'unknown'` for each and **throws for none**.
      This is REQ-2/REQ-16 asserted directly: the degraded-continue contract.
- [ ] **TC-6**: `GET /health` against a real local API server process — expected:
      HTTP 200, `content-type: application/json`, body has `ok`, `server:'local'`,
      integer `api_version`, non-empty `routes`. Today this returns
      `404 Cannot GET /health`.
- [ ] **TC-7**: `GET /health` returns 200 with **no** Authorization header —
      expected: success. The diagnostic endpoint must not require a working
      connection to diagnose a broken one (REQ-3).
- [ ] **TC-8**: The cloud `/health` handler still returns `cloud: true` alongside
      the new fields — expected: backwards compatible for existing consumers.
- [ ] **TC-9**: Vendor-freshness — regenerate `cloud/functions/collector-manifest.js`
      into memory and compare byte-for-byte with the checked-in file — expected:
      identical. Mutating the canonical module without regenerating must fail
      this (REQ-6).
- [ ] **TC-10**: `firebase.json` has a `functions.predeploy` entry invoking the
      generator — expected: present (REQ-5).
- [ ] **TC-11**: Regression — every route the cloud function registers is still
      reachable through the Hosting rewrite table, including the extended
      `/health`. Re-runs the existing `firebase-rewrites.test.mjs` assertion so a
      new route with an uncovered prefix fails here, not in production.

### Phase 2 — Worker handshake at registration
*File: `conductor/tests/track-10061-handshake-e2e.test.mjs`* (real worker + `mock-target.mjs`)

- [ ] **TC-12**: Worker registers against a mock serving a complete manifest —
      expected: registration succeeds, log contains one success handshake line,
      the register body carries `collector_compat.severity === 'ok'`.
- [ ] **TC-13**: Worker registers against a mock whose manifest omits
      `POST /tracks/claim-queue` — expected: **registration still succeeds**, the
      worker still claims and runs a lane action, and the log names that exact
      route as missing. Degraded, not stranded.
- [ ] **TC-14**: Mock reports `api_version` lower than the worker's — expected:
      registration succeeds, log reports the delta, `severity: 'version-drift'`.
- [ ] **TC-15**: Mock's `/health` returns 404 (a server predating this track) —
      expected: registration succeeds, `severity: 'unknown'`, no crash, no retry
      storm.
- [ ] **TC-16**: Mock's `/health` returns the SPA's HTML with HTTP 200 (track
      10052's live failure) — expected: treated as `unknown`, not parsed as JSON,
      no `SyntaxError` escaping, registration proceeds.
- [ ] **TC-17**: Mock's `/health` hangs past the timeout — expected: handshake
      abandoned, registration proceeds. Asserts the handshake can never delay
      worker start unboundedly.
- [ ] **TC-18**: The worker's own call list is extracted from its own source, not
      hardcoded — assert `getOwnCollectorCalls()` returns ≥25 entries and includes
      `POST /conductor-files`, the path track 10052's hand-kept `WORKER_PATHS`
      silently omitted (REQ-8).
- [ ] **TC-19**: An unchanged verdict across repeated registration cycles logs
      once, not once per cycle.

### Phase 3 — 404 disambiguation
*File: `conductor/tests/track-10061-heartbeat-404.test.mjs`*

- [ ] **TC-20**: `get/post/patch/del` throwing on a non-ok response — expected:
      `err.status` equals the numeric HTTP status and `err.body` holds the
      response text (REQ-11).
- [ ] **TC-21**: Heartbeat 404 from a mock whose manifest **omits**
      `POST /worker/heartbeat` — expected: a missing-route warning, and
      `/worker/register` call count does **not** increase. Today this
      re-registers on every beat, forever.
- [ ] **TC-22**: Heartbeat 404 from a mock whose manifest **includes** the route
      (a genuinely deleted worker record) — expected: re-registration happens,
      exactly as before. Guards against over-correcting.
- [ ] **TC-23**: Heartbeat 401 — expected: re-registration, unchanged.
- [ ] **TC-24**: A 200 response whose **body** contains the string "404" —
      expected: no re-registration. The old `err.message.includes('404')` check
      would fire here.
- [ ] **TC-25**: Repeated 404s with no manifest available — expected:
      re-registration attempts stop at the cap and a single warning is logged;
      the count is asserted to be bounded, not merely "smaller" (REQ-13).
- [ ] **TC-26**: A successful handshake after the cap was hit — expected: the
      counter resets and re-registration is permitted again.

### Phase 4 — Persistence and UI
*Vitest: server integration + `WorkersList` component*

- [ ] **TC-27**: `POST /worker/register` with `collector_compat` and
      `collector_api_version` — expected: both persisted on the `workers` row.
- [ ] **TC-28**: `POST /worker/heartbeat` carrying those fields — expected:
      **not** written. Registration-only, matching the `code_sha` convention
      (REQ-9).
- [ ] **TC-29**: The worker-list endpoint feeding the UI returns both columns —
      expected: present in the response payload. Asserted separately from the
      component test, because a passing component test proves nothing about
      whether the field reaches the component.
- [ ] **TC-30**: `WorkersList` given a worker with
      `collector_compat.severity: 'missing-routes'` — expected: a warning badge
      renders, and its tooltip text contains the missing route names.
- [ ] **TC-31**: `WorkersList` given `collector_compat: null` — expected: **no**
      badge. A worker that has not handshaken is not a mismatch (REQ-10).
- [ ] **TC-32**: The badge renders in both the grid and the strip layout, matching
      how the existing mode badge is handled.
- [ ] **TC-33**: Migration applies cleanly to a schema that already has rows, and
      leaves existing rows with `NULL` in both columns.

### Phase 5 — Periodic re-check

- [ ] **TC-34**: With `LC_HANDSHAKE_INTERVAL_MS` set low, a mock that changes its
      manifest mid-run — expected: the worker's verdict updates and is pushed
      **without a restart** (REQ-15).
- [ ] **TC-35**: Default interval is 15 minutes when the env var is unset, and is
      not driven off the 10-second heartbeat timer.

## Acceptance Criteria

- [ ] All new suites pass, run for real — output read, not inferred.
- [ ] `cloud-route-parity`, `firebase-rewrites`, `collector-content-type` and
      `local-api-e2e` still pass unchanged.
- [ ] `curl localhost:8091/health` against a **restarted** API server returns the
      new JSON. The server does not hot-reload; a stale process is a false pass.
- [ ] A worker run against a deliberately incomplete collector completes a real
      lane action end to end while showing the warning badge — proving "warn and
      continue degraded" is real behaviour and not just a log line.
- [ ] Stub scan is clean: no `TODO`/`FIXME`/`not yet implemented` in any code path
      this track's `plan.md` marks `[x]`.
