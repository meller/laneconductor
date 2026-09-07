# Track AM-10075: Fire-and-forget rehash-on-read in auth() swallows errors with no logging

Four phases. Phase 1 builds the throttle in isolation, Phase 2 wires the two
existing empty catches to it, Phase 3 adds the convergence warning, Phase 4
documents it for whoever has to read the logs. TDD throughout — test cases per
phase live in `test.md`.

Scope is deliberately small. The whole defect is two `.catch(() => {})` handlers
on lines 265 and 279 of one file. The only reason this is four phases rather
than a one-line diff is that logging on a per-request hot path without a
throttle trades a silent failure for a log flood, which this repo has already
suffered once (see spec.md D1).

---

## Phase 1: A throttled logger for the auth hot path

**Problem**: Logging a fire-and-forget failure that recurs once per request
produces unbounded log volume. Track 10064's incident (560 identical lines from
560 identical 401s) is the precedent. `conductor/services/collector-health.mjs`
solved it worker-side, but `cloud/functions/` deploys standalone and is CommonJS,
so it cannot use that module (spec.md D2).

**Solution**: A small CommonJS helper in `cloud/functions/` that emits at most
one line per key per interval, with an injectable clock so it is testable
without fake timers (spec.md D6).

- [ ] Write `cloud/functions/test/auth-log-throttle.test.js` first, per `test.md`
      TC-1..TC-5. Run it and confirm it fails.
- [ ] Create `cloud/functions/log-throttle.js` exporting a factory that returns a
      `shouldLog(key, nowMs)` predicate, keyed per call site (REQ-4).
    - [ ] Interval resolves from `LC_AUTH_FAILURE_LOG_INTERVAL_MS` at call time,
          defaulting to 60000 (REQ-3) — read at call time, not module load, so a
          test can change it without re-requiring the module. Matches
          `collector-health.mjs`'s own env-at-call-time behaviour.
    - [ ] First call for a key always logs. Subsequent calls within the interval
          do not. A call after the interval logs again and resets the window.
    - [ ] Distinct keys never interfere (REQ-4).
    - [ ] No unbounded growth: the key set is fixed and small (three call sites),
          so a plain object/Map is correct here — note this explicitly in a
          comment so nobody later reaches for an LRU that isn't needed.
- [ ] Re-run and confirm green.

**Impact**: New file, no behaviour change yet. Nothing imports it.

---

## Phase 2: Log the two swallowed failures (REQ-1, REQ-2)

**Problem**: `cloud/functions/index.js:265` and `:279` discard every error. These
are the only two empty catch handlers in the file — every other error path
already logs, so this is a genuine inconsistency, not a house style.

**Solution**: Replace both empty handlers with throttled `console.error` calls
following the file's existing `[auth]`-prefixed convention.

- [ ] Add the failing cases to `cloud/functions/test/api-tokens-hashing.test.js`
      (or a sibling file — see the note below), per `test.md` TC-6..TC-11. Run
      and confirm they fail.
    - [ ] Note for the implementer: these must flush the microtask queue after
          the request completes before asserting, because the rejection handler
          runs after the response is sent. `await new Promise(r => setImmediate(r))`.
          A test that asserts immediately after `await request(app)...` will pass
          vacuously whether or not the fix is present — verify each new test
          genuinely fails before the fix.
- [ ] Wire line 265's rehash catch to log via the Phase 1 helper, key
      `rehash`.
- [ ] Wire line 279's `last_used_at` catch to log via the same helper, key
      `last_used_at` (REQ-2).
- [ ] Keep both strictly fire-and-forget (REQ-6): no `await`, no change to the
      `return resolveWorkerIdentity(...)` flow, no new branch on the auth path.
- [ ] Update the comment above line 265 — it currently justifies the
      fire-and-forget shape without mentioning that the failure is now observable.
- [ ] Re-run the full `cloud/functions` suite and confirm green, including the
      pre-existing track 10070 tests (TC-5/TC-6/TC-7 there mock the rehash call
      and must keep passing unchanged).

**Impact**: A failing rehash or `last_used_at` update becomes visible in Cloud
Logging. No request-path behaviour change.

---

## Phase 3: Warn when the table has not converged (REQ-5)

**Problem**: Phase 2 tells an operator the table is *not converging*. It does not
tell them there is anything left to converge — a deployment where the rehash
works fine but tokens are rarely used still holds plaintext credentials, and the
only way to know is the manual SQL query in the migration file.

**Solution**: `auth()` already knows, because it just matched a plaintext row
(spec.md D3). Log that observation, throttled, at `warn`.

- [ ] Add `test.md` TC-12..TC-14 and confirm they fail.
- [ ] Log a throttled `console.warn('[auth] api_tokens row still plaintext ...')`
      inside the existing `if (tokenRows[0].token === bearer)` branch, key
      `plaintext_observed`.
    - [ ] Never include the bearer token, the raw row, or any prefix of either.
          The whole point of track 10070 was to stop credentials being at rest;
          putting one in a log line would reintroduce the same class of problem
          in a different store. Log the fact and the workspace_id, nothing more.
- [ ] Confirm a hashed row produces no warning (REQ-7) — the existing TC-7 in
      `api-tokens-hashing.test.js` already pins that no UPDATE is issued; this
      adds that no warning is emitted either.
- [ ] Re-run and confirm green.

**Impact**: "This deployment still holds plaintext credentials" becomes
self-reporting rather than something a human must remember to check.

---

## Phase 4: Operator documentation (REQ-8)

**Problem**: Three new log lines nobody knows to look for are barely better than
no log lines. The migration file is currently the only place that documents how
to check convergence, and it documents a manual query.

**Solution**: Document what each line means and what to do, next to the existing
convergence guidance.

- [ ] Add an operator note to
      `migrations/20260906120000_hash_legacy_api_tokens.sql`'s comment block —
      it already carries the "after applying, this should return 0" guidance, so
      it is where someone chasing convergence already looks. Point at the log
      lines as the proactive counterpart to that manual query.
- [ ] Document in the same place (or a short section in `conductor/product.md`'s
      remote-api area, whichever reviewer prefers — decide during implementation,
      do not do both):
    - [ ] The Cloud Logging filter that finds all three lines.
    - [ ] What each of the three means and the expected operator action:
          rehash failure → check database write permissions on `api_tokens`;
          `last_used_at` failure → same for `api_keys`, lower severity, purely
          cosmetic data loss; plaintext observed → run the bulk migration.
    - [ ] That the throttle is per-instance (spec.md D5), so a burst of N
          identical lines across a minute means N warm instances, not N failures.
- [ ] Note `LC_AUTH_FAILURE_LOG_INTERVAL_MS` and its 60s default.

**Impact**: The signals added in Phases 2–3 are actionable by someone who was not
in this track.

---

## Out of scope

Recorded so a reviewer does not read these as gaps. Full reasoning in spec.md's
Non-Goals.

- Removing the plaintext fallback arm of the lookup.
- A periodic convergence sweep or manager health-sweep integration (spec.md D3).
- Any metrics or alerting backend beyond log lines and a documented filter.
- Changes to the migration's SQL, the hashing scheme, or token rotation.
