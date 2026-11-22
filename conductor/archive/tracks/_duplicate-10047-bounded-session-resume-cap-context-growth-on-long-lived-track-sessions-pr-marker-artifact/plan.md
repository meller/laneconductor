# Track 10047: Bounded Session Resume — Cap Context Growth on Long-Lived Track Sessions

Five phases, ordered so every phase is independently verifiable and nothing changes worker
behavior until Phase 3. Phases 1 and 2 are additive-only: after either, dispatch behavior is
byte-identical to `main`.

Threshold defaults and the failure-mode evidence come from measurements over the 363
stream-json logs in `conductor/logs/` — see `spec.md`'s "Three corrections" section. Do not
re-derive them from the intake description in `index.md`; two of its stated premises are
wrong and are corrected there.

---

## Phase 1: Pure measurement + cap policy (no wiring)

**Problem**: The cap decision and the token extraction are the two pieces most likely to be
silently wrong — one would disable resume entirely, the other would trip on the first
measurement. Both must be provable in isolation before anything calls them.
**Solution**: Two pure functions with unit tests, wired to nothing.

- [x] Task 1.1: Add `extractSessionContextTokens(logContent)` to `conductor/stream-json-tail.mjs` (REQ-2)
    - [x] Last `assistant` event wins, mirroring `extractFinalAssistantText`'s existing shape
    - [x] Sum `usage.cache_read_input_tokens + usage.cache_creation_input_tokens`
    - [x] **Ignore `result` events entirely** — its `cache_read_input_tokens` is a cumulative
          cross-turn sum (2,152,229 vs a true 148,710 on `local-fs-review-10044-1788260734688.log`)
    - [x] Return `null` (not `0`) when no assistant-level usage exists
    - [x] Tolerate malformed JSONL lines the same way the sibling extractors do
- [x] Task 1.2: Create `conductor/services/session-cap.mjs` with `shouldCapSession()` (REQ-1)
    - [x] Signature `{ lastContextTokens, resumeCount, maxContextTokens, maxResumes }` → `{ cap, reason }`
    - [x] Token check is primary; resume-count check consulted **only** when
          `lastContextTokens` is null/undefined (REQ-5)
    - [x] A `0` threshold disables that check; unknown inputs never cap (REQ-10)
    - [x] Header comment records *why* 400K and not the 150–200K originally proposed, with the
          p50/p90 figures — this is the number a future reader will most want justified
- [x] Task 1.3: Write `conductor/tests/session-cap.test.mjs` (TC-1 … TC-9 in `test.md`)
- [x] Task 1.4: Run it and confirm green, including the real-log fixture case (TC-4)

**Impact**: Two new pure exports. No behavior change anywhere.

---

## Phase 2: Persistence — schema, collector endpoints, mock parity

**Problem**: The cap decision needs a measurement taken at the end of the *previous* run.
Nothing currently stores one.
**Solution**: Two additive columns and the endpoint changes to read/write them.

- [x] Task 2.1: Atlas migration `add_session_context_bounds` (REQ-3)
    - [x] `last_context_tokens INTEGER NULL`, `resume_count INTEGER NOT NULL DEFAULT 0`
    - [x] Update `prisma/schema.prisma`'s `track_sessions` model to match
    - [x] Regenerate `migrations/atlas.sum`
- [x] Task 2.2: `GET /track/:num/session` returns the two new fields (`ui/server/index.mjs:3333`)
- [x] Task 2.3: `POST /track/:num/session` accepts optional `context_tokens` (`ui/server/index.mjs:3346`)
    - [x] `resume_count` increments when `claude_session_id` is unchanged, resets to `0` when it changes
    - [x] `last_context_tokens` overwritten **only** when `context_tokens` is supplied — a POST
          without it must not erase a prior measurement (AC-9)
    - [x] Keep the existing `req.worker_id` scoping; no client-supplied worker id
- [x] Task 2.4: Mirror both in `conductor/tests/mock-collector.mjs`, preserving `sessionsByToken`
      per-worker scoping (REQ-7) — the worker E2E tests run against this, so a mock without
      these fields cannot exercise the cap
- [x] Task 2.5: Extend `ui/server/tests/track-1086-sessions.test.mjs` (TC-10 … TC-13)
- [x] Task 2.6: Run `cd ui && npm test` — confirm green, including the pre-existing 1086 and
      10037 session tests (10037 joins `track_sessions`; the migration must not disturb it)

**Impact**: Sessions carry a size and a resume count. Still nothing reads them.

---

## Phase 3: Worker wiring — measure on exit, cap on resolve

**Problem**: The choke point is unbounded.
**Solution**: Report the measurement after each run; consult it before each resume.

- [x] Task 3.1: Config knobs in `laneconductor.sync.mjs` (REQ-4), following the
      `LC_SPAWN_TIMEOUT_MS` precedence pattern at line 5035
    - [x] `LC_SESSION_MAX_CONTEXT_TOKENS` → `config.worker?.session_max_context_tokens` → `400000`
    - [x] `LC_SESSION_MAX_RESUMES` → `config.worker?.session_max_resumes` → `12`
- [x] Task 3.2: `resolveTrackSession()` (line 5766) applies the cap (REQ-8)
    - [x] Read `last_context_tokens` / `resume_count` off the same GET response
    - [x] On cap: `await invalidateTrackSession(trackNumber)`, then return a fresh
          `randomUUID()` with `isFresh: true` — **reuse** the existing invalidation path, do
          not add a second one
    - [x] Verify the downstream consequences actually follow — `sessionArgs` becomes
          `--session-id` (line 5808), `freshnessMarker` becomes `FRESH_SESSION: true`
          (line 5809), and spawnCli's injection gate at line 4958 re-enables the full
          file-based context. This is the whole safety argument for the cap (spec Correction 1);
          it must be observed, not assumed
    - [x] Log line per REQ-12: track, retired session id, measured value, threshold, reason
    - [x] Do **not** post to `conversation.md` — a cap is not a terminal lane-action outcome
- [x] Task 3.3: `persistTrackSession(trackNumber, claudeSessionId, contextTokens = null)` forwards
      `context_tokens` when present (line 5783)
- [x] Task 3.4: Measure in `spawnCli`'s exit handler (REQ-9)
    - [x] Reuse the `logContent` already read at line 5169 — do not re-read the log
    - [x] Call `extractSessionContextTokens`, and when non-null report it via `persistTrackSession`
    - [x] Best-effort throughout: a failed extraction or POST must never affect the run's
          outcome, matching how the neighbouring run-marker and claim-release cleanups behave
    - [x] Place it so it does not fight the resume-failure invalidation at lines 5239–5242 —
          do not report a measurement for a session that was just invalidated
- [x] Task 3.5: Confirm `local-fs` is untouched (REQ-11) — `resolveTrackSession` returns `null`
      at line 5767 before any of this

**Impact**: The cap is live. This is the phase that can regress track 1086.

---

## Phase 4: End-to-end verification against a real worker

**Problem**: Phases 1–3 are unit-verified. The thing that actually has to work is a real
worker process choosing `--session-id` over `--resume` and getting its context back.
**Solution**: Worker E2E tests in the established `track-1086-session-worker.test.mjs` shape
(real worker process + `mock-collector.mjs` + `mock-cli.mjs`).

- [x] Task 4.1: `conductor/tests/track-10047-bounded-resume.test.mjs` (TC-14 … TC-18)
- [x] Task 4.2: TC-14 — over-threshold session ⇒ next dispatch cold-starts, old id gone (AC-1)
- [x] Task 4.3: TC-15 — that cold start carries full context injection + `FRESH_SESSION: true` (AC-2).
      Assert on the injected prompt via the collector/mock-CLI observation the 1086 suite already
      uses (`PRODUCT_MD_MARKER`), not on argv
- [x] Task 4.4: TC-16 — under-threshold session still `--resume`s the same uuid (AC-3)
- [x] Task 4.5: TC-17 — collector returning neither field ⇒ behavior identical to today (AC-6)
- [x] Task 4.6: TC-18 — local-fs run creates and caps no session (AC-7)
- [x] Task 4.7: **Run the full pre-existing session suite and confirm no regression** (AC-10):
      `track-1086-session-worker.test.mjs`, `track-1086-session-resilience-worker.test.mjs`,
      `track-10020-resumed-session-unanswered-tail.test.mjs`, `session-resilience.test.mjs`,
      `context-cap.test.mjs`

**Impact**: The feature is verified as a real user-facing behavior, not just as passing units.

---

## Phase 5: Documentation and calibration record

**Problem**: `product.md` currently advertises session continuity with no mention of a bound,
and the threshold's justification lives only in this track's spec.
**Solution**: Update the one product-facing claim and leave the calibration where the next
person to tune it will find it.

- [x] Task 5.1: Update `conductor/product.md`'s *"Session continuity across lane actions
      (`--resume`)"* row — continuity is bounded, and past the bound a run cold-starts with
      full file-based context re-injected (REQ-13)
- [x] Task 5.2: Note the two config knobs and their defaults alongside the existing
      `worker.mode` / `worker.spawn_timeout_ms` documentation
- [x] Task 5.3: Record the measurement method in `session-cap.mjs`'s header so the threshold
      can be re-derived on new data (the `conductor/logs/` scan: last-assistant
      `cache_read + cache_creation`, first-turn = inherited, peak = end-of-run)

**Impact**: The bound is discoverable and re-tunable rather than a magic number.

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Threshold too low ⇒ resume silently never happens, reverting track 1086 | 400K default sits above the p90 single-action range; AC-3 and TC-16 assert a normal session still resumes |
| Threshold too high ⇒ cap never fires | Observed dead zone is 620K–725K; 400K fires well before it. TC-14 asserts the cap actually triggers |
| Measuring the `result` event instead of `assistant` ⇒ cap fires on every run | REQ-2 forbids it explicitly; TC-4 pins it against a real log where the two differ 14× |
| Cold start loses genuinely needed mid-run state | Correction 1 in `spec.md`: the cap re-enables full file-based injection, which is the durable record the codebase already treats as authoritative. TC-15 verifies it arrives |
| Migration disturbs the 10037 worker-last-track `LEFT JOIN LATERAL` on `track_sessions` | Both columns additive and defaulted; Task 2.6 runs that suite |
