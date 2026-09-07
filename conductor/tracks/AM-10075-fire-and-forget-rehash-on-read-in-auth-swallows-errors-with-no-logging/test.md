# Tests: Track 10075 — Fire-and-forget rehash-on-read in auth() swallows errors with no logging

## Test Commands

```bash
# The suite that matters for this track (jest + supertest, all DB calls mocked)
cd cloud/functions && npm test

# Just this track's new files
cd cloud/functions && npx jest test/auth-log-throttle.test.js
cd cloud/functions && npx jest test/auth-fire-and-forget-logging.test.js

# The pre-existing track 10070 suite that must keep passing unchanged
cd cloud/functions && npx jest test/api-tokens-hashing.test.js
```

## Harness notes

Two things will silently produce vacuously-passing tests here. Both were
identified while planning; read them before writing a single case.

**1. The rejection handler runs after the response.** `auth()` does not await
either update, so `await request(app).get(...)` resolves before the `.catch()`
handler has run. Asserting on `console.error` immediately after the request
passes whether or not the fix exists. Flush the microtask queue first:

```js
await request(app).get('/api/projects').set('Authorization', `Bearer ${RAW_TOKEN}`);
await new Promise((resolve) => setImmediate(resolve));
expect(errorSpy).toHaveBeenCalled();
```

Confirm every new case in TC-6..TC-14 actually fails before the fix is written.
A test that cannot fail is not a test.

**2. The existing file uses `mockReset`, not `clearAllMocks`, deliberately.**
`api-tokens-hashing.test.js` documents why: `clearAllMocks` drops recorded calls
but leaves the `mockResolvedValueOnce` queue intact, so a test that queues more
responses than it consumes shifts every assertion in the *next* test by one and
fails far from the cause. Follow the same pattern, and remember that
`mockRejectedValueOnce` sits in that same queue — a rejection queued but not
consumed will surface as an unhandled rejection in a later test.

Spy on the console rather than letting it write:
`jest.spyOn(console, 'error').mockImplementation(() => {})`, restored in
`afterEach`.

---

## Test Cases

### Phase 1 — `cloud/functions/log-throttle.js`

Pure unit tests, injectable clock, no timers, no app.

- [ ] **TC-1**: First call for a key returns true — expected: a never-before-seen
      key always logs.
- [ ] **TC-2**: A second call for the same key 1ms later returns false —
      expected: within-interval repeats are suppressed.
- [ ] **TC-3**: A call exactly at `interval` and one past it return true, and the
      window resets from that call — expected: suppression is bounded, and a
      failure that persists for an hour yields ~60 lines, not one.
- [ ] **TC-4**: Two distinct keys called back to back both return true, and
      suppressing one does not suppress the other — expected: REQ-4, a failing
      rehash can never mask a failing `last_used_at` update.
- [ ] **TC-5**: With `LC_AUTH_FAILURE_LOG_INTERVAL_MS=5000` set after the module
      was required, a call 6000ms later returns true — expected: the interval is
      read at call time, not frozen at module load, so tests and operators can
      change it without a restart.

### Phase 2 — the two swallowed failures

New file `cloud/functions/test/auth-fire-and-forget-logging.test.js`, reusing
the mock scaffolding from `api-tokens-hashing.test.js`.

- [ ] **TC-6**: Plaintext row matches, the rehash UPDATE rejects with
      `permission denied for table api_tokens` — expected: `console.error` called
      once with a message containing `[auth]`, identifying the rehash, and
      carrying `permission denied for table api_tokens`.
- [ ] **TC-7**: Same as TC-6 — expected: the response is still `200`, with the
      same body as a successful run. A rejected fire-and-forget update must not
      fail the request (REQ-6).
- [ ] **TC-8**: Plaintext row matches, the rehash UPDATE resolves normally —
      expected: `console.error` not called. The happy path stays silent (REQ-7).
- [ ] **TC-9**: `api_keys` path, the `last_used_at` UPDATE rejects — expected:
      `console.error` called with a message identifying the `last_used_at`
      update, distinguishable from TC-6's rehash line, and the request still
      returns 200 (REQ-2, REQ-6).
- [ ] **TC-10**: Ten consecutive requests all hitting a rejecting rehash, with
      the clock held inside one interval — expected: exactly one
      `console.error`, not ten (REQ-3). This is the whole reason Phase 1 exists;
      without it the fix trades a silent failure for a log flood.
- [ ] **TC-11**: A rejecting rehash followed by a rejecting `last_used_at` in the
      same interval — expected: two `console.error` calls, one per call site.
      Throttling is per key, so one broken table never hides another (REQ-4).

### Phase 3 — convergence warning

- [ ] **TC-12**: A plaintext row authenticates — expected: `console.warn` called
      once with an `[auth]` line stating the row is still plaintext, and the
      request still returns 200.
- [ ] **TC-13**: The same warning's arguments — expected: the raw bearer token
      does not appear anywhere in the logged output, in full or as any prefix.
      Assert against the actual `RAW_TOKEN` string. Logging a credential into a
      second store is the exact class of problem track 10070 existed to fix.
- [ ] **TC-14**: An already-hashed row authenticates — expected: no
      `console.warn`, no `console.error`, and (as the existing TC-7 in
      `api-tokens-hashing.test.js` already pins) no UPDATE issued. A fully
      migrated deployment produces no new output at all (REQ-7).

### Regression — track 10070's existing suite

- [ ] **TC-15**: `npx jest test/api-tokens-hashing.test.js` passes unmodified —
      expected: TC-5, TC-6 and TC-7 there mock the rehash call and assert on the
      SQL and params; adding logging must not change the call sequence they
      depend on. If these needed editing to pass, the change altered request-path
      behaviour and violates REQ-6.
- [ ] **TC-16**: `npm test` in `cloud/functions` passes whole — expected: no
      unhandled rejection warnings introduced by the new rejecting mocks.

### Phase 4 — documentation

- [ ] **TC-17**: The documented Cloud Logging filter, applied to the log output
      the Phase 2/3 tests produce, matches all three line types — expected: an
      operator following the doc actually finds the lines. Verify by checking the
      documented filter's literal substrings against the strings asserted in
      TC-6, TC-9 and TC-12; a filter that matches nothing is worse than no doc.

## Acceptance Criteria

- [ ] TC-1..TC-17 all pass.
- [ ] Every new test in TC-6..TC-14 was observed failing before its fix was
      written, per the TDD protocol and the microtask-flush warning above.
- [ ] `cd cloud/functions && npm test` is green, with `api-tokens-hashing.test.js`
      unmodified.
- [ ] No regression in authentication: status codes, response bodies, and the
      `resolveWorkerIdentity` flow are unchanged for every path in
      `api-tokens-hashing.test.js` and `worker-identity.test.js`.
- [ ] `grep -n "catch(() => {})" cloud/functions/index.js` returns nothing.
