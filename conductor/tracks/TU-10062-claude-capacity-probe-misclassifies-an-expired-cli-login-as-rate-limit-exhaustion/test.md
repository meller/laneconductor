# Tests: Track TU-10062 — Claude capacity probe misclassifies an expired CLI login as rate-limit exhaustion

## Test Commands

```bash
# Worker unit + integration (node:test). NOTE: this repo's node --test runs
# require `env -u NODE_TEST_CONTEXT` — see quality-gate.md's track-1096 gotcha.
env -u NODE_TEST_CONTEXT node --test conductor/tests/provider-probe-classify.test.mjs
env -u NODE_TEST_CONTEXT node --test conductor/tests/capacity-probe-throttle.test.mjs
env -u NODE_TEST_CONTEXT node --test conductor/tests/exhaustion-detector.test.mjs
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10062-auth-required.test.mjs

# UI (Vitest)
cd ui && npm test -- WorkersList

# Syntax
find conductor ui bin -name "*.mjs" -not -path "*/node_modules/*" -exec node --check {} +
```

No test may invoke the real `claude` binary. Probe behaviour is driven through a fake CLI
(`conductor/tests/mock-cli.mjs` / `fake-claude-recorder.mjs`) and the mock collector
(`conductor/tests/mock-target.mjs`), so results do not depend on the developer's own login
state — which is exactly the variable under test.

## Test Cases

### Phase 1 — `classifyClaudeProbe` (`conductor/tests/provider-probe-classify.test.mjs`)

- [x] TC-1: `{ code: 0, output: 'I am here.' }` — expected: `status: 'ok'`, `available: true`,
      `reset_at: null`.
- [x] TC-2 (**the bug**): `{ code: 1, output: 'Failed to authenticate: OAuth session expired and
      could not be refreshed' }` — the exact text confirmed live 2026-09-04 — expected:
      `status: 'auth_required'`, `available: false`, `reset_at: null`. Must **not** be
      `exhausted`.
- [x] TC-3: `reset_at` is `null` for `auth_required` regardless of the `nowMs` passed. Calling
      the classifier twice with `nowMs` values a minute apart yields the identical result
      object — this is the unit-level guard for the rolling-estimate defect.
- [x] TC-4: `last_error` for `auth_required` mentions `claude login`, and `remedy` states that
      this is the standalone CLI's own OAuth session rather than a Claude Code app session.
- [x] TC-5: `{ code: 1, output: "You've hit your limit · resets 3pm (Europe/Berlin)" }` —
      expected: `status: 'exhausted'` with `reset_at` at 15:00 local. Preserves today's
      behaviour.
- [x] TC-6: `resets 10:30pm` parses to 22:30 — the minute-bearing form the shared
      `isProviderExhausted` regex alone cannot handle, proving REQ-3's parse stayed in the
      classifier.
- [x] TC-7: A parsed reset time already in the past rolls to tomorrow.
- [x] TC-8: Exhausted but unparseable (`'quota exhausted'`, no `resets`) — expected:
      `status: 'exhausted'` with `reset_at ≈ nowMs + 15m`, not `nowMs + 60s`.
- [x] TC-9: `{ code: 1, output: 'Error: ENOENT spawn claude' }` — expected:
      `status: 'probe_failed'`, `reset_at: null`, and `last_error` containing that output.
      Must **not** be `exhausted`.
- [x] TC-10 (**precedence**): output containing *both* an auth phrase and the word `exhausted`
      classifies as `auth_required` — auth is checked first (REQ-2).
- [x] TC-11 (**no false positive**): output containing a bare `401` with no auth phrasing (e.g.
      a URL or a byte count) does **not** classify as `auth_required`.
- [x] TC-12: `isBlockingProviderStatus` — true for `exhausted`, `auth_required`,
      `probe_failed`; false for `ok` and for `available` (the value posted at
      `laneconductor.sync.mjs:2972`).

### Phase 2 — availability decisions (`provider-probe-classify.test.mjs` + existing suites)

- [x] TC-12a: Every existing case in `conductor/tests/capacity-probe-throttle.test.mjs` still
      passes after `decideCapacityProbe` switches to `isBlockingProviderStatus` — run the file
      unmodified.
- [x] TC-12b: `decideCapacityProbe` with a fresh cached `auth_required` entry — expected:
      `{ skip: true, available: false }`. Before the fix this returned `available: true`,
      because `auth_required !== 'exhausted'`.
- [x] TC-12c: `decideCapacityProbe` with an `auth_required` entry older than the 60s TTL —
      expected: `skip: false` (a real re-probe), which is what makes recovery automatic (REQ-6).

### Phase 4 — board rendering (`ui/src/components/WorkersList.test.jsx`)

- [x] TC-13: Strip layout, provider `{ status: 'auth_required' }` — renders `LOGIN REQUIRED`
      and no green/healthy dot.
- [x] TC-14: Grid layout, same provider — badge is not `HEALTHY`, and the body names
      `claude login` and states it will not recover on its own.
- [x] TC-15: `probe_failed` renders `PROBE FAILED` with its `last_error`, in both layouts.
- [x] TC-16: `{ status: 'exhausted', reset_at: <future> }` still renders `EXHAUSTED` with the
      countdown, and `{ status: 'ok' }` still renders `HEALTHY`. No regression.

### Phase 6 — end-to-end regressions (`conductor/tests/track-10062-auth-required.test.mjs`)

- [x] TC-17 (**AC-3**): A worker probing a fake CLI that always exits 1 with the OAuth-expired
      text, across three probe cycles — expected: `provider_status` receives `auth_required`
      with `reset_at: null` every time. Assert the stored `reset_at` never becomes non-null and
      never advances. This is the direct regression for the 09:34 → 09:47 rolling estimate.
- [x] TC-18 (**AC-4**): Across those same cycles, `isProviderAvailable('claude')` returns false
      every time, and no dispatch is spawned. Direct regression for the burned claim/spawn
      attempt per cycle.
- [x] TC-19 (**AC-6**): An explicit dispatch blocked by `auth_required` is marked failed with a
      result naming the provider and the `claude login` remedy — asserted as *not equal to*
      `'no provider available'` — and exactly one `⚠️` `> **system**:` comment is appended to
      the track's `conversation.md`. Assert **one**, not one-or-more: the throttling in REQ-10
      is the point.
- [ ] TC-20 (**AC-8**): After the fake CLI is switched to exit 0, the next probe past the 60s
      TTL records `ok`, and a dispatch proceeds — with no worker restart and no manual cache or
      DB edit.
- [x] TC-21 (**AC-2**): A fake CLI emitting a genuine rate-limit message still produces
      `exhausted` with a parsed `reset_at`, and the provider becomes available again once that
      time passes. The old behaviour is preserved, not replaced.

### Phase 3 & 5 — reason plumbing

- [x] TC-22: `providerBlockReason('claude')` with an `auth_required` cache entry returns a
      string naming both the provider and the login remedy; with an `exhausted` entry it names
      the reset time instead.
- [x] TC-23 (**AC-7**): `lc status` against a project whose `provider_status` row is
      `auth_required` prints the remedy. Local-fs mode prints no provider line at all.

## Acceptance Criteria

- [ ] All test cases above pass.
- [ ] `conductor/tests/capacity-probe-throttle.test.mjs` and
      `conductor/tests/exhaustion-detector.test.mjs` pass unmodified — the shared modules were
      extended, not repurposed.
- [ ] No test invokes the real `claude` binary; results are independent of the developer's own
      login state.
- [ ] Full worker suite shows no new failures relative to `main`, diff-confirmed against a
      worktree at `main`'s tip rather than assumed (the comparison method
      `conductor/quality-gate.md` records for track 1102).
- [ ] `find conductor ui bin -name "*.mjs" -not -path "*/node_modules/*" -exec node --check {} +`
      reports no errors.
