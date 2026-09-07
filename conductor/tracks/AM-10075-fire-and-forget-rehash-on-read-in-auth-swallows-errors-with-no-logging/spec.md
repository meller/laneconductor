# Spec: Fire-and-forget writes in `auth()` must not swallow errors

## Problem Statement

PR #25 (track 10070, merged as `bac2902`) closed the plaintext `api_tokens`
vulnerability. Part of that fix is a self-healing mechanism: when `auth()`
matches a row still in its pre-migration plaintext form, it rehashes the row in
place on the way through, fire-and-forget, so the table converges to all-hashed
even in a deployment that never runs the bulk migration.

`cloud/functions/index.js:265`:

```js
query('UPDATE api_tokens SET token = $1 WHERE token = $2', [tokenHash, bearer]).catch(() => {});
```

The catch handler is empty. Any failure of this UPDATE — a permission error, a
read-only replica, lock contention, a transient connection blip, a future schema
change that rejects the write — is discarded with no `console.error`, no metric,
and no signal of any kind. Nothing would ever tell an operator it happened.

This undermines the PR's own safety argument. The entire "deploy ordering doesn't
matter, the table converges on its own" design rests on this UPDATE succeeding
over time. If it silently never succeeds, the table never converges, plaintext
credentials stay at rest indefinitely, and the only way to discover it is for a
human to remember to run the manual query documented in
`migrations/20260906120000_hash_legacy_api_tokens.sql`:

```sql
SELECT count(*) FROM api_tokens WHERE left(token, 3) = 'lc_';
```

It also violates this repo's own `conductor/code_styleguides/javascript.md`
Error Handling rules: *"Don't swallow errors silently"* and *"Log errors with
context: `console.error('[context]:', err.message)`"*.

Found during PR #25's 7-angle code review, independently by two review angles
(line-by-line, altitude/conventions).

### Premise correction found during planning

The track's filed description says the fix should match *"the existing pattern
already used a few lines above for `api_keys`'s `last_used_at` update, which is
NOT silent."*

**That is not what the code does.** `cloud/functions/index.js:279` is:

```js
query('UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = $1', [tokenHash]).catch(() => {});
```

Also an empty catch. These two lines are the *only* two empty catches in the
entire 2000+ line file — every other error path already logs. So there is no
good local pattern to copy, and copying the named one would be a no-op. Both
call sites are in scope for this track (REQ-1, REQ-2).

## Requirements

- **REQ-1**: A failing `UPDATE api_tokens SET token = ...` rehash logs an error
  including the error message and enough context to identify the call site.
  Follows the file's established `console.error('[auth] ...', err.message)`
  convention.
- **REQ-2**: The `UPDATE api_keys SET last_used_at = NOW() ...` update logs on
  failure the same way. Same defect, same file, one line apart — fixing one and
  leaving the other is not a defensible stopping point.
- **REQ-3**: Repeated failures are throttled to at most one log line per
  interval per call site. Default 60s, overridable via
  `LC_AUTH_FAILURE_LOG_INTERVAL_MS`.
- **REQ-4**: The throttle is keyed per call site, so a failing rehash can never
  suppress a failing `last_used_at` update or vice versa.
- **REQ-5**: Observing a still-plaintext `api_tokens` row logs a throttled
  warning that the table has not converged — distinct from REQ-1's
  "it is not converging" error.
- **REQ-6**: None of this may change request behaviour. The updates stay
  fire-and-forget: no `await`, no added latency, no change to status code or
  response body, and a rejected update still cannot fail the request.
- **REQ-7**: A successful rehash and a successful `last_used_at` update log
  nothing. The happy path stays silent.
- **REQ-8**: An operator-facing note documents what these lines mean and what to
  do about them, including the log filter to find them.

## Design Decisions

**D1 — Throttle, don't just log.** Both updates sit on the hot auth path and run
once per authenticated request. An unthrottled `console.error` turns one
persistent broken condition into unbounded log volume at full request rate. A
worker heartbeating every 5s against a read-only replica would emit a line every
5s forever. This repo has already been burned by exactly this failure: track
10064 hit 560 consecutive identical 401s producing 560 identical log lines and
nothing else, and fixed it with a throttled escalation in
`conductor/services/collector-health.mjs`. We reuse that *reasoning*, not that
module.

**D2 — A local throttle helper, not a vendored one.** Firebase deploys
`cloud/functions/` standalone (`functions.source` in `firebase.json`), so it
cannot `require()` anything under `conductor/`, and the cloud function is
CommonJS while `collector-health.mjs` is ESM. The repo does have a vendoring
pattern for this (`cloud/functions/collector-manifest.js`), but it costs a
generator script, a byte-identical drift test, and a predeploy hook. That is
disproportionate for a ~15-line throttle with no other consumer. Write it
locally in `cloud/functions/`.

**D3 — Warn when a plaintext row is observed, rather than adding a periodic
sweep.** The track suggests a periodic health check running the "any plaintext
rows left?" query. `auth()` already knows the answer at the exact moment it
matters — it just matched such a row. That signal is free, needs no new query,
and fires precisely when a plaintext credential is in use. A periodic sweep
would need a new authenticated cloud endpoint plus worker-side plumbing (the
worker has no access to the cloud database) to learn something `auth()` can
simply say. Track 10067's manager health-sweep is worker-side and shipped
already; integrating it here would be a strictly more expensive way to get a
strictly weaker signal.

**D4 — The plaintext count does not go on `/health`.** `/health` is
unauthenticated. How many plaintext credentials are sitting in the database is
exactly the kind of hygiene detail not to hand an anonymous caller.

**D5 — Throttle state is per-instance, and that is accepted.** Cloud Functions
instances persist between requests but scale horizontally, so N warm instances
can each emit up to one line per interval. Bounded, proportional to real traffic,
and vastly better than one line per request. A globally-shared throttle would
need shared state on the auth path, which is a worse trade than occasional
duplicate log lines. Documented, not engineered around.

**D6 — An injectable clock, matching `collector-health.mjs`.** That module takes
`nowMs` and `logIntervalMs` as parameters specifically so the throttle is
testable without fake timers. Same approach here.

## Non-Goals

- **Not removing the plaintext fallback arm** of the `api_tokens` lookup. That
  becomes dead code once every deployment has converged; deciding it has is a
  separate, deliberate call and this track makes that decision *easier* to make
  by surfacing the data, not automatic.
- **Not building a periodic sweep or a manager health-sweep integration** (D3).
- **Not adding a metrics/alerting backend.** The output is structured log lines
  plus a documented Cloud Logging filter. Wiring those to an alert policy is an
  operator action, not code in this track.
- **Not changing the migration** (`20260906120000_hash_legacy_api_tokens.sql`) or
  the hashing scheme. Track 10070 settled those.
- **Not rotating or revoking any token.** The migration file already records that
  rehashing preserves tokens and rotation is a separate decision.

## Acceptance Criteria

- [ ] An operator whose `api_tokens` rehash is failing in production can see
      that fact in Cloud Logging, with the underlying error message, without
      having been told in advance to go looking for it.
- [ ] An operator whose `api_keys` `last_used_at` update is failing can see that
      too.
- [ ] A deployment still holding plaintext credentials produces a log line
      saying so each time one is used, so "the table has not converged" is
      discoverable without running the manual SQL query by hand.
- [ ] A persistently failing update produces roughly one line per minute per
      instance, not one line per request — a broken database does not bury the
      logs.
- [ ] A rehash failure, a `last_used_at` failure, and a plaintext observation
      are each distinguishable from the other two in the logs.
- [ ] Authentication behaviour is unchanged: a request whose fire-and-forget
      update rejects still returns the same status and body it did before, with
      no added latency.
- [ ] A fully-migrated deployment sees no new log output at all.
- [ ] `cd cloud/functions && npm test` passes, including the existing track
      10070 hashing tests.

## API Contracts / Data Models

No schema change. No route change. No request or response shape change. The only
externally observable difference is what appears on stderr/Cloud Logging.
