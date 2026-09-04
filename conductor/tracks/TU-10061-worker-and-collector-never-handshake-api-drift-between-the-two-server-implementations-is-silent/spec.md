# Spec: Collector Handshake — API Version + Route Manifest

## Problem Statement

LaneConductor has two independent implementations of one collector API:
`ui/server/index.mjs` (local, port 8091) and `cloud/functions/index.js`
(Firebase). A worker talks to whichever it is pointed at. **Nothing at runtime
ever checks that the server on the other end implements the contract the worker
expects**, and the drift is silent every time.

Four concrete facts, confirmed live 2026-09-03:

1. **No version negotiation exists anywhere.** `POST /worker/register` sends
   `hostname`, `pid`, `project_id`, `mode`, `cli`, `model`, `available_models`,
   `code_sha` and `worktrees` — and no API or protocol version. Neither server
   reports one. Nothing compares them.

2. **The two servers disagree on their most basic endpoint.** `GET /health`
   returns `{ok:true,cloud:true}` from the cloud function
   (`cloud/functions/index.js:328`) and `404 Cannot GET /health` from the local
   server, which has no such route. The endpoint you would naturally use to ask
   *what am I talking to* exists on exactly one of the two.

3. **The worker actively mis-diagnoses a missing route.** In the heartbeat
   error path (`conductor/laneconductor.sync.mjs:1253`) a 404 is treated
   identically to a 401 and triggers `upsertWorker()` to re-register, on the
   assumption that the worker record vanished. A 404 actually means *this server
   does not implement that route*. Against a server missing the route the worker
   re-registers forever and never surfaces the real cause. The check is also
   textual — `err.message.includes('404')` — so a 200 response whose *body*
   contains "404" triggers it too.

4. **There is already a confession of this failure mode in the code.**
   `laneconductor.sync.mjs:2765` (track 10053) records that a transition call
   was sending `POST` to a route registered as `app.patch` in both servers, so
   it 404'd every time, unnoticed because the `.catch()` only warns. That call
   was dead weight for an unknown length of time, and was found by
   `conductor/tests/cloud-route-parity.test.mjs`'s control assertion — not by
   anything at runtime.

This is the root pattern behind both track 10052 (Firebase rewrite globs
silently serving the SPA's HTML for 24 of 27 endpoints) and track 10053 (11
route families missing from the cloud function outright). In both cases a worker
registered successfully and then failed at everything real, and a human had to
notice the weirdness and go digging.

The static parity tests now catch drift **at build time in this repo**. Nothing
catches it at runtime, and nothing at all catches **a deployed server simply
being older than the worker talking to it** — the normal state of affairs the
moment there is more than one machine.

## Desired Behaviour (decided with the product owner)

**Warn and continue degraded. Do not hard-fail.** A version or capability
mismatch must be loud and visible in the UI *and* the worker log, but must never
strand a worker pointed at a slightly stale deploy. Hard-failing would turn every
routine deploy lag into an outage.

## Design Decisions

### D1 — The manifest is the router, not a list

The track's own framing is decisive: *"keep the two in one shared source of
truth rather than two hand-kept lists, since a hand-kept list is exactly what let
track 10052's `WORKER_PATHS` silently omit `/conductor-files`."*

Therefore each server derives its route manifest **at request time from its own
live Express router** (`app._router.stack`; both servers are Express 4, verified
in `ui/package.json` and `cloud/functions/package.json`). There is no list to
keep in sync — what the server reports is literally what it registered. A route
added, removed, or renamed changes the manifest in the same commit, with no
second edit to forget.

This is strictly more accurate than the existing static `extractExpressRouteEntries`
regex, which only sees `app.<method>('/literal')` and therefore misses the local
server's mounted sub-router (`app.use('/auth', authRouter)` at
`ui/server/index.mjs:169`). The static extractor stays where it is — it serves the
*build-time* checks — but it is not what the runtime manifest is built from.

### D2 — The handshake rides on `GET /health`, not a new path

A new top-level path would need a matching entry in **both** hosting targets'
rewrite tables in `firebase.json`, or Firebase Hosting silently serves the SPA's
`index.html` — track 10052's exact failure. `/health` and `/health/**` are already
rewritten for both the `landing` and `app` targets, and `/health` already exists
on the cloud side.

So the handshake is served by extending `GET /health` on both servers, and by
**adding the missing `/health` route to the local server** so both ends answer the
same basic question. One endpoint, one question.

The cloud response keeps its existing `cloud: true` field so no current consumer
is affected.

Response shape (both servers):

```json
{
  "ok": true,
  "server": "local",
  "api_version": 1,
  "routes": ["DELETE /track/:num/session", "GET /track/:num", "POST /worker/register"]
}
```

`routes` entries are `"<METHOD> <express route pattern>"`, deduped and sorted.

### D3 — `api_version` is a hand-bumped integer; the manifest carries the detail

Two different questions deserve two different answers:

- **"Does this server serve the specific endpoint I am about to call?"** — the
  route manifest answers this exactly, and derives itself (D1).
- **"Is this deploy older or newer than me in a way route names cannot express?"**
  — a changed request/response *shape* on an unchanged route name is invisible to
  a route manifest. That is what the integer is for.

`COLLECTOR_API_VERSION` is a monotonic integer, bumped by hand when the wire
contract changes in a way a route list cannot express. Its meaning is
deliberately narrow, and the doc comment says so, because a version integer
nobody knows when to bump is worse than none.

### D4 — Cross-runtime sharing: vendor + assert, because Firebase deploys a subdirectory

`firebase.json` sets `functions.source: "cloud/functions"`, so the deployed
function bundle contains **only that directory** — it cannot `require` anything
under `conductor/`. The cloud function is also CommonJS while the rest of the
repo is ESM.

Resolution:

- Canonical implementation: `conductor/services/collector-manifest.mjs` (ESM).
  Imported directly by `ui/server/index.mjs` and by the worker.
- Vendored copy: `cloud/functions/collector-manifest.js` (CommonJS), produced
  from the canonical file by `conductor/scripts/vendor-collector-manifest.mjs`,
  a mechanical `export` → `module.exports` transform. The generated file carries
  a `DO NOT EDIT` banner naming its source.
- **A test asserts the vendored copy is current**: regenerate into memory and
  compare against what is checked in. Drift fails the suite.
- A `predeploy` hook in `firebase.json` regenerates it, so a deploy cannot ship a
  stale copy even if someone skipped the test.

This is a *generated-and-asserted* artifact, not a hand-kept list. That
distinction is the whole point of D1.

### D5 — The worker compares against its own call list, reusing proven code

The worker already has, in this repo, a tested extractor for exactly this:
`extractWorkerCalls()` and `findUnservedCalls()` in
`conductor/services/collector-route-parity.mjs`, backed by
`conductor/tests/cloud-route-parity.test.mjs`. The worker reads its own source
(`import.meta.url`), extracts its call list once, caches it, and diffs it against
the served manifest with `findUnservedCalls()`.

No new list, no second implementation, and the same code path the build-time test
already exercises.

### D6 — Fixing the 404 conflation, and making the loop bounded regardless

Two independent changes, because either alone leaves a hole:

1. **Structural status, not string matching.** `get/post/patch/del` attach
   `err.status` (and `err.body`) to the thrown error instead of only formatting
   the status into the message. The heartbeat path then branches on `err.status`.
2. **A 404 is a missing route unless the manifest says otherwise.** Re-register
   on 401 always. On 404, re-register only if the collector's manifest reports
   `POST /worker/heartbeat` as served — that is a genuine *worker record gone*.
   If the manifest says the route is not served, log
   `⚠️ route not implemented by this collector` and do **not** re-register.
3. **Bounded regardless.** If no manifest is available (the handshake itself
   failed), consecutive re-register attempts are capped; past the cap the worker
   logs once at warn level and stops retrying until the next successful
   handshake. A worker must never be able to re-register forever, whatever the
   manifest situation.

### D7 — Visible in the UI, not only in the log

The mismatch result is sent on `POST /worker/register` and persisted on the
`workers` row, then rendered in `WorkersList.jsx` as a warning badge with a
tooltip naming the specific missing routes or version delta — following the
existing precedent of the `⚠ No worker for this project` badge
(`WorkersList.jsx:653-660`).

This is the requirement the track states explicitly: *"surface a mismatch in the
UI where a human will actually see it, not only in the log."* A log-only warning
is what let tracks 10052 and 10053 run undetected.

### D8 — Re-check periodically, not only at registration

A server can be redeployed under a long-lived worker; a registration-time check
alone would report a compatibility verdict that quietly became false hours ago.
The handshake re-runs on a timer, at a deliberately slow cadence (default 15
minutes, `LC_HANDSHAKE_INTERVAL_MS`) — not on the 10-second heartbeat, which
would add a request per collector per beat for information that changes only on
deploy.

## Requirements

- **REQ-1**: `conductor/services/collector-manifest.mjs` exports
  `COLLECTOR_API_VERSION` (integer), `buildRouteManifest(app)` (derives
  `{method, route}` entries from a live Express 4 app, including routes mounted
  via `app.use(prefix, router)`), `formatManifestRoutes(entries)`, and
  `compareManifest({ workerVersion, workerCalls, manifest })` returning a
  structured verdict.
- **REQ-2**: `compareManifest` returns
  `{ compatible, severity, apiVersionDelta, missingRoutes, reason }` and **never
  throws** — a malformed, empty, or absent manifest yields
  `severity: 'unknown'`, not an exception. Degraded-continue is the contract.
- **REQ-3**: `GET /health` on `ui/server/index.mjs` returns `{ok, server:'local',
  api_version, routes}`. The route must be unauthenticated — it is the endpoint
  used to diagnose a broken connection, so requiring a working connection to
  reach it defeats its purpose.
- **REQ-4**: `GET /health` on `cloud/functions/index.js` returns the same shape
  plus its existing `cloud: true`, built from the vendored module.
- **REQ-5**: `cloud/functions/collector-manifest.js` is generated by
  `conductor/scripts/vendor-collector-manifest.mjs`, carries a `DO NOT EDIT`
  banner naming its source, and is wired as a `firebase.json` `predeploy` hook.
- **REQ-6**: A test regenerates the vendored file in memory and asserts it is
  byte-identical to the checked-in copy.
- **REQ-7**: `upsertWorker()` performs the handshake per collector before
  registering: `GET /health`, compare via `compareManifest`, log the verdict.
  A failed or absent handshake never blocks registration.
- **REQ-8**: The worker's own call list comes from `extractWorkerCalls()` applied
  to its own source file, read once and cached — no hand-maintained list.
- **REQ-9**: `POST /worker/register` accepts a `collector_compat` field and
  persists it, alongside the collector's reported `api_version`, on the `workers`
  row. Written at registration only, never on the heartbeat — matching the
  existing `code_sha` convention.
- **REQ-10**: A migration adds `workers.collector_api_version` (integer, null) and
  `workers.collector_compat` (jsonb, null). Both nullable; a worker that has not
  handshaken is not a mismatch.
- **REQ-11**: `get/post/patch/del` in the worker attach `err.status` and
  `err.body` to thrown errors.
- **REQ-12**: The heartbeat error path branches on `err.status`: 401 → re-register;
  404 → re-register **only** if the manifest reports the heartbeat route as served,
  otherwise log a distinct missing-route warning and do not re-register.
- **REQ-13**: Consecutive re-register attempts are capped. Past the cap the worker
  warns once and stops until the next successful handshake.
- **REQ-14**: `WorkersList.jsx` renders a warning badge for a worker whose
  `collector_compat` records a mismatch, with a tooltip naming the version delta
  and the missing routes.
- **REQ-15**: The handshake re-runs on a timer (default 15 min, overridable via
  `LC_HANDSHAKE_INTERVAL_MS`), and updates the persisted verdict when it changes.
- **REQ-16**: Nothing in this track can hard-fail a worker. Every new failure path
  logs and continues.

## Acceptance Criteria

- [ ] A worker started against a collector that serves every route it calls logs a
      single line confirming a matched handshake, and the UI shows no warning badge.
- [ ] A worker started against a collector missing routes it calls **still
      registers and still runs lane actions**, logs a warning naming the specific
      missing routes, and shows a warning badge in the UI whose tooltip names them.
- [ ] A worker started against a collector reporting an older `api_version` still
      registers and runs, and reports the version delta in log and UI.
- [ ] `GET /health` against the local server returns JSON with `api_version` and a
      non-empty `routes` array. It currently returns `404 Cannot GET /health`.
- [ ] The local server's `routes` array includes at least one route registered
      through `app.use('/auth', authRouter)`, proving mounted routers are covered.
- [ ] A heartbeat 404 from a server missing the heartbeat route produces a
      missing-route warning and **no** re-registration, where today it re-registers
      indefinitely.
- [ ] A heartbeat 404 from a server that does serve the route (a genuinely deleted
      worker record) still re-registers, unchanged.
- [ ] Editing a route in `cloud/functions/index.js` without regenerating the
      vendored manifest module fails the test suite.
- [ ] Adding a route to either server changes that server's `/health` output with
      no other edit to any file.
- [ ] Redeploying a collector under a running worker updates that worker's badge
      within one handshake interval, without a worker restart.
- [ ] No new code path can terminate a worker process or block registration.

## Out of Scope

- Porting the route families still missing from the cloud function (track 10053's
  Phase 6). This track makes their absence **visible at runtime**; it does not
  implement them.
- Any change to Firebase Hosting rewrite globs (track 10052, already landed in
  `firebase.json` — both `/prefix` and `/prefix/**` forms are present for both
  hosting targets).
- Request/response *body* schema validation. The manifest covers route existence
  and a coarse version integer, not field-level contracts.

## Data Model Changes

```sql
ALTER TABLE workers ADD COLUMN collector_api_version INTEGER;
ALTER TABLE workers ADD COLUMN collector_compat JSONB;
```

`collector_compat` shape:

```json
{
  "severity": "ok" | "version-drift" | "missing-routes" | "unknown",
  "checked_at": "2026-09-04T10:00:00.000Z",
  "collector_url": "https://app.laneconductor.com",
  "server": "cloud",
  "worker_api_version": 1,
  "collector_api_version": 1,
  "missing_routes": ["POST /tracks/claim-queue"]
}
```
