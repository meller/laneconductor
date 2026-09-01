# Tests: Track 10047 — Bounded Session Resume

## Test Commands

```bash
# Phase 1 — pure cap policy + token extraction
node --test conductor/tests/session-cap.test.mjs

# Phase 2 — collector endpoints (vitest + supertest)
cd ui && npm test -- track-1086-sessions

# Phase 4 — worker E2E (real worker process + mock collector + mock CLI)
node --test conductor/tests/track-10047-bounded-resume.test.mjs

# Regression gate (AC-10) — must stay green
node --test conductor/tests/track-1086-session-worker.test.mjs
node --test conductor/tests/track-1086-session-resilience-worker.test.mjs
node --test conductor/tests/track-10020-resumed-session-unanswered-tail.test.mjs
node --test conductor/tests/session-resilience.test.mjs
node --test conductor/tests/context-cap.test.mjs
cd ui && npm test
```

---

## Test Cases

### Phase 1 — `extractSessionContextTokens` (`conductor/tests/session-cap.test.mjs`)

- [ ] **TC-1**: Log whose last `assistant` event has
      `usage: { cache_read_input_tokens: 148710, cache_creation_input_tokens: 212 }` —
      expected: `148922`.
- [ ] **TC-2**: Log with no `assistant` events at all (non-claude CLI output, or a killed run) —
      expected: `null`, not `0`.
- [ ] **TC-3**: Log with multiple `assistant` events (15171 → 147896 → 148710) —
      expected: the **last** one, matching `extractFinalAssistantText`'s last-wins semantics.
- [ ] **TC-4** *(the correction that matters most)*: A log containing both a final `assistant`
      event at 148,710 **and** a trailing `result` event reporting
      `cache_read_input_tokens: 2152229` — expected: `~148922`, i.e. the `result` event is
      ignored. Built from the real shape of `conductor/logs/local-fs-review-10044-1788260734688.log`,
      where these two figures genuinely differ by 14×.
- [ ] **TC-5**: Log containing malformed/truncated JSONL lines interleaved with valid ones —
      expected: malformed lines skipped, the last valid assistant usage still returned.
- [ ] **TC-6**: Empty string / `null` input — expected: `null`, no throw.

### Phase 1 — `shouldCapSession`

- [ ] **TC-7**: `{ lastContextTokens: 500000, resumeCount: 1, maxContextTokens: 400000, maxResumes: 12 }`
      — expected: `{ cap: true, reason: 'context-tokens' }`.
- [ ] **TC-8**: `{ lastContextTokens: 164000, resumeCount: 3, maxContextTokens: 400000, maxResumes: 12 }`
      — expected: `{ cap: false, reason: null }`. Guards against the 150–200K
      over-aggressive threshold that would disable resume entirely (spec Correction 2).
- [ ] **TC-9**: Fallback and inert cases —
      (a) `lastContextTokens: null, resumeCount: 15, maxResumes: 12` → `{ cap: true, reason: 'resume-count' }`;
      (b) `lastContextTokens: null, resumeCount: 2` → `{ cap: false }`;
      (c) `lastContextTokens: 900000, resumeCount: 99` with **both** thresholds `0` → `{ cap: false }`;
      (d) `lastContextTokens: 900000, resumeCount: 99, maxContextTokens: 400000` → capped by
          tokens, i.e. the token check takes precedence over the count check (REQ-5);
      (e) all inputs `undefined` → `{ cap: false }` (REQ-10, never cap on unknown data).

### Phase 2 — Collector endpoints (`ui/server/tests/track-1086-sessions.test.mjs`)

- [ ] **TC-10**: `GET /track/:num/session` returns `claude_session_id`, `last_context_tokens`,
      and `resume_count` — expected: all three present; a row that predates the migration
      reports `last_context_tokens: null, resume_count: 0`.
- [ ] **TC-11**: `POST` with the **same** `claude_session_id` twice — expected: `resume_count`
      goes `0 → 1 → 2` (AC-8).
- [ ] **TC-12**: `POST` with a **different** `claude_session_id` for the same track — expected:
      `resume_count` resets to `0` (AC-8).
- [ ] **TC-13**: `POST` with `context_tokens: 250000`, then a second `POST` **without**
      `context_tokens` — expected: `last_context_tokens` remains `250000`, not nulled (AC-9).

### Phase 4 — Worker E2E (`conductor/tests/track-10047-bounded-resume.test.mjs`)

Same harness as `track-1086-session-worker.test.mjs`: real worker process, `mock-collector.mjs`,
`mock-cli.mjs`, assertions against the collector's `/_state` and the injected prompt — not argv
(see that file's header for why argv is the wrong assertion surface under `LC_MOCK_CLI`).

- [ ] **TC-14**: Seed the collector with a session at `last_context_tokens: 500000`, run the
      worker with `LC_SESSION_MAX_CONTEXT_TOKENS=400000`, dispatch a lane action — expected:
      the spawn uses a **new** session id (fresh path, `--session-id` semantics) and the
      seeded id is no longer stored for that track (AC-1).
- [ ] **TC-15**: The same run as TC-14 — expected: the prompt contains the full injected
      context (`PRODUCT_MD_MARKER` and the track's own doc blocks) and `FRESH_SESSION: true`.
      This is the criterion that proves a capped run does not start blind, and is the direct
      test of spec Correction 1 (AC-2).
- [ ] **TC-16**: Seed a session at `last_context_tokens: 164000` with the same 400000
      threshold — expected: the dispatch **resumes** the same uuid, `FRESH_SESSION: false`,
      and no full context re-injection (unchanged 1086 behavior) (AC-3).
- [ ] **TC-17**: Run against a collector whose `GET /track/:num/session` omits both new fields —
      expected: identical behavior to current `main`; no cap, session resumed (AC-6).
- [ ] **TC-18**: Run the worker in `local-fs` mode — expected: no session GET/POST/DELETE
      traffic at all and no cap logic reached (AC-7).
- [ ] **TC-19**: `LC_SESSION_MAX_CONTEXT_TOKENS=0` with a 900000-token stored session —
      expected: still resumes (check disabled, REQ-4).

### Phase 4 — Regression gate

- [ ] **TC-20**: All five pre-existing suites listed under Test Commands pass unchanged, plus
      `cd ui && npm test` (AC-10). Specifically confirms the migration does not disturb
      `track-10037-worker-last-track.test.mjs`'s `LEFT JOIN LATERAL` on `track_sessions`.

---

## Acceptance Criteria

- [ ] TC-1 … TC-20 pass
- [ ] A capped run is observed spawning with a new session id **and** receiving full context
      injection — verified by running it, not by reading the diff
- [ ] A normal multi-action track completes without ever being capped (proves the threshold is
      not so low that it silently disables session resume)
- [ ] No regression in tracks 1086, 1087, 10020, or 10037 behavior
- [ ] `local-fs` mode behavior unchanged
