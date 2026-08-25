# Tests: Track 10032 — F18 claim-timeout, surface the outcome in the UI

## Test Commands

```bash
# Server + frontend unit/integration (vitest)
cd ui && env -u NODE_TEST_CONTEXT npx vitest run

# Just this track's server tests
cd ui && npx vitest run server/tests/track-10032-dispatch-reap-visibility.test.mjs

# Track 1102's existing reaper tests — must stay green (regression guard)
cd ui && npx vitest run server/tests/track-1102-f18b-dispatch-claim-timeout.test.mjs

# Browser (fast tier — this track's spec lands here by default)
npx playwright test --project=fast
npx playwright test conductor/tests/playwright/track-10032-dispatch-reap-ui.spec.js

# Syntax
find conductor ui bin -name "*.mjs" -not -path "*/node_modules/*" -exec node --check {} +
```

**Prerequisites for the API/browser tiers** — the API server does not hot-reload
and the new columns only exist after a boot that ran `runMigration()`:

```bash
make api-stop && make api-start   # applies ui/server/migrations/011_dispatch_reap.sql
make ui-start                     # localhost:8090
```

## Test Cases

### Phase 1 — reap outcome recorded (`track-10032-dispatch-reap-visibility.test.mjs`, mocked pool)

- [ ] TC-1.1: Reassign branch writes `reap_reason` — expected: the `UPDATE
      worker_dispatch SET worker_id …` call also sets `reaped_at` and a
      `reap_reason` naming both the dead worker id and the replacement id.
- [ ] TC-1.2: Fail branch writes `reap_reason` — expected: the `UPDATE
      worker_dispatch SET status = 'failed'` call also sets `reaped_at` and a
      `reap_reason` matching `/timeout/i`; `result` is still written as it is
      today (no regression to the existing failed rendering).
- [ ] TC-1.3: Stale-selection SQL carries `reaped_at IS NULL` — expected: asserted
      against the **actual SQL text** sent to the pool (same mutation-safe pattern
      `track-1102-f18b-*.test.mjs` uses), so deleting the predicate fails this test.
- [ ] TC-1.4: Stale-selection SQL selects `track_number` and `action` — expected:
      present in the SQL text; the reason string and the Inbox comment both depend
      on them.
- [ ] TC-1.5: Track-1102 regression — expected: all 5 tests in
      `track-1102-f18b-dispatch-claim-timeout.test.mjs` still pass unchanged
      (timeout window param, phantom exclusion, reassign, fail, no-op when not stale).

### Phase 2 — Inbox comment (`track-10032-dispatch-reap-visibility.test.mjs`, mocked pool)

- [ ] TC-2.1: Track-scoped reassignment inserts exactly one `system` comment —
      expected: one `INSERT INTO track_comments` call, `author = 'system'`, body's
      first character is `⚠️`.
- [ ] TC-2.2: Track-scoped failure inserts exactly one `system` comment —
      expected: body's first character is `❌`.
- [ ] TC-2.3: `track_number IS NULL` dispatch inserts **no** comment — expected:
      zero `INSERT INTO track_comments` calls, and no thrown error (AC-4).
- [ ] TC-2.4: Unresolvable track (dispatch for a since-deleted track) inserts no
      comment and does not throw — expected: loop completes, remaining stale rows
      still reaped (REQ-9).
- [ ] TC-2.5: A comment-insert rejection does not abort the loop — expected: with
      two stale entries where the first one's insert throws, the second is still
      reaped.
- [ ] TC-2.6: Already-reaped row is not re-processed — expected: with
      `reaped_at IS NULL` in the selection query, a reassigned-but-still-pending
      dispatch produces no second comment on the next cycle (AC-5).

### Phase 2/3/4 — API response shape (supertest against exported `app`, real pool)

- [ ] TC-3.1: `GET /api/tracks/:id/dispatch` carries `reap_reason` and `reaped_at`
      for a seeded reaped row — expected: 200, fields present and non-null.
- [ ] TC-3.2: `GET /api/projects/:id/dispatch` carries the same for a seeded
      reaped **deploy** (`track_number IS NULL`) row — expected: 200, fields present.
- [ ] TC-3.3: Never-reaped rows answer with `reap_reason: null` — expected: 200,
      explicit `null`, not a missing key (AC-6/AC-7).
- [ ] TC-3.4: `GET /api/inbox?project_id=…` returns the reaped track in bucket
      `needs_input` with the `⚠️`/`❌` body — expected: exactly the bucket
      `ui/server/index.mjs:999`'s classification implies (AC-3).

### Phase 3/4/5 — live browser (`track-10032-dispatch-reap-ui.spec.js`, fast tier)

- [ ] TC-4.1: Seeded reassigned dispatch renders in the track detail panel —
      expected: amber `⟳` row present via `data-testid="dispatch-reaped-<id>"`,
      reason text visible, full reason in the `title` attribute.
- [ ] TC-4.2: Seeded failed-by-timeout dispatch renders as failed with the timeout
      reason — expected: red `✗` row, reason readable (AC-2).
- [ ] TC-4.3: Never-reaped dispatches render unchanged — expected: `✓`/`✗`/`•` as
      today, no reaped marker (AC-6).
- [ ] TC-4.4: The Inbox lists the reaped track under "Needs your input" —
      expected: visible from the board without opening the track (AC-3).
- [ ] TC-4.5: A reaped deploy dispatch shows the marker in the CI/CD view's
      dispatch history — expected: marker present, and no Inbox entry created for
      it (AC-4).
- [ ] TC-4.6: Cleanup — expected: `afterAll` removes every seeded
      `worker_dispatch` / `track_comments` row, following
      `track-1112-worktree-panel.spec.js`'s pattern; a re-run of the spec starts
      from a clean DB.

### Phase 1/5 — migration

- [ ] TC-5.1: `011_dispatch_reap.sql` is idempotent — expected: two consecutive
      API boots both log `migration 011_dispatch_reap.sql applied (idempotent)`
      with no warning (`runMigration()` re-runs every file every boot).
- [ ] TC-5.2: Pre-existing rows survive — expected: dispatch rows created before
      the migration answer with `reap_reason: null` and render exactly as before
      (AC-7).

## Acceptance Criteria

- [ ] All new tests in `track-10032-dispatch-reap-visibility.test.mjs` pass.
- [ ] `track-1102-f18b-dispatch-claim-timeout.test.mjs` still passes unchanged.
- [ ] `npx playwright test --project=fast` passes as a whole — not only the new spec.
- [ ] `cd ui && npx vitest run` shows no failures **new to this branch**
      (diff-confirm against `main`'s own tip, per `conductor/quality-gate.md` —
      this repo has a known set of pre-existing failures).
- [ ] `cd ui && npx vite build` succeeds.
- [ ] The API server was **restarted** before the API/browser verification, and the
      observed result is recorded (screenshot or real API response) — not inferred
      from reading the diff.
