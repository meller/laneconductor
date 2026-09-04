# Track TU-10062: Claude capacity probe misclassifies an expired CLI login as rate-limit exhaustion

Implementation order is TDD throughout — each phase's cases in `test.md` are written and
confirmed failing before the code that satisfies them.

## Phase 1: The classifier (pure module)

**Problem**: `checkClaudeCapacity()` collapses every non-zero `claude -p test` exit into
`status: 'exhausted'` with a rolling `Date.now() + 60000` guess. There is no seam to test the
decision without spawning a real CLI.

**Solution**: Extract the decision into a pure module, mirroring `capacity-probe-throttle.mjs`
and `exhaustion-detector.mjs`.

- [x] Create `conductor/services/provider-probe-classify.mjs`
    - [x] `PROVIDER_STATUS = { OK: 'ok', EXHAUSTED: 'exhausted', AUTH_REQUIRED: 'auth_required', PROBE_FAILED: 'probe_failed' }`
    - [x] `isBlockingProviderStatus(status)` — true for `exhausted`, `auth_required`,
          `probe_failed`; false for `ok`, `available` (the value posted at
          `laneconductor.sync.mjs:2972`) and anything unrecognised
    - [x] `classifyClaudeProbe({ code, output, nowMs })` →
          `{ status, available, reset_at, last_error, remedy }`
    - [x] `code === 0` → `ok`, `available: true`, `reset_at: null` (REQ-1)
    - [x] Auth matchers checked **first** (REQ-2), tight enumerated list, no bare `401`
    - [x] Rate-limit gate = `isProviderExhausted(output, 'claude')` OR `/\bresets\b/i` OR
          `/\bexhausted\b/i` — imported, not re-implemented (REQ-3)
    - [x] Keep the existing `/resets\s+(\d{1,2})(:?\d{2})?(am|pm)/i` parse and its
          roll-to-tomorrow behaviour; `+15m` fallback when exhausted but unparseable
    - [x] `auth_required` and `probe_failed` return `reset_at: null` unconditionally (REQ-4)
    - [x] `last_error` / `remedy` strings per REQ-7; `probe_failed` carries a truncated first
          line of the probe's own output
- [x] Write `conductor/tests/provider-probe-classify.test.mjs` (TC-1 … TC-12 in `test.md`)
    - [x] Confirm the auth and no-rolling-reset cases fail against no module, then pass

**Impact**: A testable seam. No behaviour change yet — nothing imports the module.

## Phase 2: Wire the classifier into the worker

**Problem**: Three separate sites treat `status !== 'exhausted'` as "available"
(`capacity-probe-throttle.mjs:32`, `laneconductor.sync.mjs:3709`, `:3738`). Introducing
`auth_required` without touching them makes an unusable provider read as **available** —
strictly worse than today.

**Solution**: Route the probe through the classifier and make every availability decision use
the shared predicate.

- [x] `conductor/services/capacity-probe-throttle.mjs` — replace `cached.status !== 'exhausted'`
      with `!isBlockingProviderStatus(cached.status)` (REQ-5). Existing
      `capacity-probe-throttle.test.mjs` must still pass unchanged.
- [x] `laneconductor.sync.mjs` `checkClaudeCapacity()` (~:3641) — call `classifyClaudeProbe`;
      set the cache and POST `/provider-status` with the classified `status`, `reset_at` and
      `last_error` (REQ-7)
- [x] `laneconductor.sync.mjs` `isProviderAvailable()` (~:3709, ~:3738) — both branches use
      `isBlockingProviderStatus` (REQ-5). A blocking status with a null `reset_at` returns
      false and does **not** delete the cache entry (REQ-4/REQ-6).
- [x] Distinct log lines per status (REQ-8) — `auth_required` must not print the existing
      `[status] Claude capacity exhausted, marking in DB (cool down until ...)`
- [x] Confirm the 60s TTL still governs re-probing, so recovery is automatic (REQ-6)

**Impact**: The DB now tells the truth. `reset_at` stops rolling; the optimistic
reset-time-passed re-trigger can no longer fire for an auth failure.

## Phase 3: Name the reason at the block sites

**Problem**: `lane_action_result: 'no provider available'` names neither the provider nor the
cause. This is what kept the real failure hidden until a dispatch was chased down by hand.

**Solution**: Format the reason from the same cache entry the block decision came from.

- [x] Add `providerBlockReason(cli)` to `laneconductor.sync.mjs`, reading `providerStatusCache`
- [x] Use it at all three `buildCliArgs() === null` sites (REQ-9):
    - [x] `:6598` local-fs auto-launch — replaces `[local-fs] No available provider for track N. Skipping.`
    - [x] `:6789` auto-complete — folded into the existing `reportAutoCompleteResult` message
    - [x] `:8443` explicit dispatch — replaces the `'no provider available'` result string
- [x] Also name the reason in `buildCliArgs`'s own `[blocked]` logs (`:6124`, `:6135`)
- [x] REQ-10: at `:8443` only, append one `> **system**: ⚠️ ...` line to the track's
      `conversation.md` (same `appendFileSync` pattern as `:8540`), naming the `claude login`
      remedy. **Not** at `:6598` — that path runs on the 5s idle tick across every queued
      track and would flood every conversation in the project.

**Impact**: A blocked dispatch says what to do about it, in the Inbox and in the dispatch row.

## Phase 4: Surface it on the board

**Problem**: `ui/src/components/WorkersList.jsx` computes `isExhausted = p.status ===
'exhausted'` in both layouts and falls through to a green dot / `HEALTHY` badge for every other
value — so an `auth_required` provider would render as healthy.

**Solution**: Give the two non-exhausted blocking states their own presentation.

- [x] Strip layout `ProviderStatus` (~:43) — `auth_required` → amber/red dot, `LOGIN REQUIRED`,
      remedy in the existing `title` tooltip; `probe_failed` → `PROBE FAILED` with `last_error`
- [x] Grid layout card (~:293) — same two states: badge text, body copy stating plainly that an
      expired login will **not** recover on its own and naming `claude login`, and the card's
      red border/background treatment
- [x] Neither state may render the green dot or `HEALTHY` badge (REQ-11)
- [x] Extend `ui/src/components/WorkersList.test.jsx` with the render cases (TC-13 … TC-16)

**Impact**: The state is visible where a human already looks, which is the gap that let this go
unnoticed.

## Phase 5: Surface it in the terminal

**Problem**: `lc status` reports worker health and target count but says nothing about provider
health.

**Solution**: One line beside the existing health lines.

- [x] `bin/lc.mjs` API-mode status branch (~:2237) — query `provider_status` for this project
      alongside the existing tracks query and print any non-`ok` provider with its `last_error`
      (REQ-12)
- [x] Skip entirely in local-fs mode — there is no `provider_status` table to read
- [x] Keep the existing `psql` failure fallback path intact

**Impact**: `lc status` answers "why is nothing running?" without opening the DB.

## Phase 6: Regression coverage and the dead duplicate

**Problem**: The three defects in `spec.md`'s Problem Statement need standing tests, and
`conductor/agent-runtime.mjs` carries an unimported near-verbatim copy of the same bug that a
future reader will mistake for live code.

**Solution**:

- [x] `conductor/tests/track-10062-auth-required.test.mjs` — the end-to-end regressions
      (TC-17 … TC-21 in `test.md`), driven through a fake CLI (`conductor/tests/mock-cli.mjs` /
      `fake-claude-recorder.mjs` pattern) and the mock collector, never a real `claude` binary
    - [x] Repeated probes against a persistently expired login leave `reset_at` null every time
          (AC-3) — the direct regression for the rolling estimate
    - [x] `isProviderAvailable('claude')` stays false across cycles while `auth_required`
          (AC-4) — the direct regression for the burned claim/spawn attempt
    - [x] A genuine rate limit still produces `exhausted` + a parsed `reset_at` (AC-2)
    - [x] Recovery: probe returns `ok` after the TTL once the fake CLI exits 0 (AC-8)
- [x] Mark `conductor/agent-runtime.mjs` as unused at the top of the file, pointing at this
      track and at `laneconductor.sync.mjs` as the live implementation. Behaviour unchanged —
      see `spec.md` Non-Goals for why the duplicated logic itself is deliberately not touched.

**Impact**: The three defects cannot regress silently, and the duplicate stops being a trap.

## ✅ COMPLETE

## ✅ REVIEWED
