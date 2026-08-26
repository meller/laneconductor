# Track 10032: F18 claim-timeout — surface the outcome in the UI

Five phases. Phases 1–2 are server-side (nothing is renderable until the outcome
is recorded), Phases 3–4 are the two UI surfaces, Phase 5 is the real test
coverage the track was filed to require.

Key file references (verified 2026-08-25):
- `ui/server/index.mjs:1786` — `reapStaleDispatches()`
- `ui/server/index.mjs:4720` — the `setInterval` that drives it
- `ui/server/index.mjs:3736` — `GET /api/tracks/:id/dispatch` (per-track history)
- `ui/server/index.mjs:4096` — `GET /api/projects/:id/dispatch` (project history)
- `ui/server/index.mjs:964` — `GET /api/inbox` bucket classification
- `ui/src/components/TrackDetailPanel.jsx:953` — per-track history strip
- `ui/src/components/CICDView.jsx:270` — `DispatchHistory`
- `ui/server/tests/track-1102-f18b-dispatch-claim-timeout.test.mjs` — existing
  reaper tests (must keep passing; they assert on the SQL text)

---

## Phase 1: Record the reap outcome durably

**Problem**: A reassignment changes only `worker_id` — the row is
indistinguishable from a healthy pending dispatch, so there is literally nothing
for any UI to render. The failure case writes `result`, which the reassigned
worker's completion PATCH later overwrites.

**Solution**: Two nullable columns on `worker_dispatch`, written by the reaper on
both branches, that no other code path overwrites.

- [x] Task 1.1: Add `ui/server/migrations/011_dispatch_reap.sql` with
      `ALTER TABLE worker_dispatch ADD COLUMN IF NOT EXISTS reaped_at TIMESTAMPTZ NULL;`
      and `... ADD COLUMN IF NOT EXISTS reap_reason TEXT NULL;`
      (`ADD COLUMN IF NOT EXISTS` is mandatory — `runMigration()`
      (`ui/server/index.mjs:2233`) re-runs every file on every boot.)
- [x] Task 1.2: Extend the stale-selection query to also select `wd.track_number`
      and `wd.action`, and to add `AND wd.reaped_at IS NULL` so an
      already-reaped-but-still-pending dispatch is not reaped (and re-commented on)
      every cycle. **Do not touch** the existing predicates — the staleness window
      (`$1 * INTERVAL '1 millisecond'`), the join, or the phantom exclusion in the
      replacement query; `track-1102-f18b-*.test.mjs` simulates Postgres by
      inspecting this SQL text and will (correctly) fail if a filter is dropped.
- [x] Task 1.3: Reassign branch — write `reaped_at = NOW()` and `reap_reason`.
      Implemented as a second `UPDATE` statement right after the `worker_id`
      one (not folded into the same statement) — folding it in would have
      added a third bind param to that call, which breaks
      `track-1102-f18b-*.test.mjs`'s strict `toEqual([REAL_WORKER.id,
      STALE_DISPATCH.id])` check on that call's params. Two statements keeps
      that call byte-for-byte identical while still writing both columns.
- [x] Task 1.4: Fail branch — write `reaped_at`/`reap_reason` alongside the
      existing `status='failed'`/`result='timeout: …'` write, in one `UPDATE`
      (`reap_reason` placed at `$3` so the pre-existing `$1`/`$2` — result and
      id — stay in their original slots, which is what the 1102 regression
      test indexes into). Kept `result` as it is today (AC-6).
- [x] Task 1.5: Verified via `track-10032-dispatch-reap-api.test.mjs` (real
      local Postgres, supertest against the exported `app`) — both
      endpoints carry `reap_reason`/`reaped_at`, explicit `null` for
      never-reaped rows (not a missing key). Also confirmed migration
      011 actually applies to the real DB (previously only applied under
      mocked-pg tests, which never touch the real DB — `\d worker_dispatch`
      showed the columns absent until this file ran).

**Impact**: Both reap outcomes become queryable facts with a stable shape. No
user-visible change yet.

**Verification for this phase**: seed a stale `pending` dispatch directly in the
DB, call `reapStaleDispatches(pool)` against the real pool, and `curl` both
endpoints — confirm `reap_reason` in the JSON. Then re-run
`cd ui && npx vitest run server/tests/track-1102-f18b-dispatch-claim-timeout.test.mjs`
and confirm all 5 existing tests still pass.

---

## Phase 2: Push the track-scoped reap into the Inbox

**Problem**: Even a perfectly annotated dispatch row is only seen by a user who
already opened that track's detail panel. The event fires ≥5 minutes after the
dispatch, server-side, typically with no relevant panel open.

**Solution**: Reuse the existing Inbox convention — a `system` comment whose body
starts with `⚠️`/`❌` lands in the `needs_input` bucket (`ui/server/index.mjs:999`).
No new UI surface.

- [x] Task 2.1: In the reaper, for a reaped entry with non-null `track_number`,
      resolve the track id: `SELECT id FROM tracks WHERE project_id = $1 AND
      track_number = $2`. A miss is normal and non-fatal (dispatch for a track
      deleted since) — skip the comment, do not throw.
- [x] Task 2.2: Insert one `system` comment per reap event, matching the shape
      `POST /api/projects/:id/tracks/:num/comment` uses
      (`ui/server/index.mjs:3159`): `INSERT INTO track_comments(track_id, author,
      body, is_replied) VALUES ($1, 'system', $2, false)`.
      - reassignment → `⚠️ Dispatch <action> was unclaimed for over <N>s — worker
        <id> appears dead; reassigned to worker <id>.`
      - failure → `❌ Dispatch <action> failed: unclaimed for over <N>s and no
        other live worker was available to reassign to.`
      The leading emoji must be the literal first character of the body — that is
      what `/api/inbox`'s `LIKE '⚠️%'` / `LIKE '❌%'` matches on.
- [x] Task 2.3: `broadcast('track:updated', { projectId, trackNumber })` after a
      track-scoped reap (`broadcast` is already imported at
      `ui/server/index.mjs:14`), so an open board/panel refetches immediately
      rather than waiting out its own poll interval.
- [x] Task 2.4: Keep every one of the above inside the existing per-entry
      `try/catch` (REQ-9) — a comment-insert failure must not stop the loop
      reaping the remaining stale rows.

**Impact**: A claim timeout now reaches the user on the board, without them
having to know which track to open.

**Verification for this phase**: seed a stale dispatch on a real track, run the
reaper, then `curl 'localhost:8091/api/inbox?project_id=1'` and confirm the track
comes back with `bucket: "needs_input"` and the expected `last_comment_body`.
Then open the Inbox in the browser and confirm it renders there.

---

## Phase 3: Annotate the per-track dispatch history strip

**Problem**: `TrackDetailPanel.jsx:953–970` renders `•` for anything not
`done`/`failed`/`claimed`, so a reassigned dispatch looks healthy.

**Solution**: A distinct reaped state in the strip, driven by `reap_reason`.

- [x] Task 3.1: In the strip's marker logic, branch on `d.reap_reason` **before**
      the `status` branches for the pending case: render an amber `⟳` when
      `reap_reason` is set and `status !== 'failed'`; keep the red `✗` for
      `failed` (which now also carries a `reap_reason`).
- [x] Task 3.2: Render the reason text on the row and put the full string in
      `title=` (the row is `truncate`d — the existing `d.result` rendering already
      does this and is the pattern to follow).
- [x] Task 3.3: Add a stable `data-testid` (e.g. `dispatch-reaped-<id>`) so
      Phase 5's browser check has something non-brittle to assert on.
- [x] Task 3.4: Confirmed by construction — `isReapedPending`/`reasonText` are
      both gated on `d.reap_reason` being truthy, so a row with `reap_reason
      == null` falls through to the exact original `status` branches and
      `d.result` text (AC-6).

**Impact**: A user investigating a stalled track sees *why* it stalled and what
the system did about it, in the panel they were already in.

**Verification for this phase**: with a seeded reaped row, open the track panel in
a browser and read the line. Screenshot it.

---

## Phase 4: Annotate the project-level (CI/CD) dispatch history

**Problem**: `deploy` / `create-project` / `set_model` dispatches carry
`track_number IS NULL` — no track panel, and Phase 2's Inbox comment cannot apply.
`CICDView`'s `DispatchHistory` (`CICDView.jsx:270`) is their only surface, and it
shows nothing about a reap.

**Solution**: The same reaped marker, in that list.

- [x] Task 4.1: Render the reaped marker + reason in `DispatchHistory`'s row,
      matching Phase 3's treatment (amber `⟳`, reason in `title`).
- [x] Task 4.2: Confirmed by TC-2.3 (mocked pool: zero `track_comments`
      inserts for a null-track dispatch) and TC-3.2 (real DB: a reaped
      deploy dispatch surfaces `reap_reason` via `GET
      /api/projects/:id/dispatch` with no error and no track to comment on).

**Impact**: The one class of dispatch with no track to fall back on stops being
silently reaped.

---

## Phase 5: Real test coverage

**Problem**: The track was filed asking for *real* coverage — an API-level proof
that the response carries the reason, plus a live browser check that it renders.
Unit tests over a mocked pool (which is all track 1102 has) cannot show either.

**Solution**: Two tiers, mirroring what already exists in this repo.

- [x] Task 5.1: Extended in a **new** file
      `ui/server/tests/track-10032-dispatch-reap-visibility.test.mjs` (18/18
      passing incl. the 5 pre-existing 1102 tests unchanged). Covers:
      `reap_reason` on both branches, the `reaped_at IS NULL` predicate and
      `track_number`/`action` columns present in the stale-selection SQL text
      (mutation-safe), one comment per track-scoped reap, zero comments for
      null `track_number`, zero comments for an unresolvable track, a
      comment-insert rejection not aborting the loop.
- [x] Task 5.2: New file `ui/server/tests/track-10032-dispatch-reap-api.test.mjs`
      — real local Postgres (not mocked; this repo's established pattern for
      SQL-level/migration-level proof, per `track-10012-inbox-buckets.test.mjs`
      and `track-1102-f10c-live-db-fk.test.mjs`), supertest against the
      exported `app`. 5/5 passing: both dispatch-history endpoints carry
      `reap_reason`/`reaped_at` (explicit `null` for never-reaped rows), the
      Inbox bucket is `needs_input` with the right emoji for both the
      reassign and fail branches, and no double-comment on a second reap
      cycle. This also proved migration 011 actually applies to the real DB
      (it hadn't, until this file ran — every other test in this suite mocks
      `pg`).
- [x] Task 5.3: New Playwright **fast-tier** spec
      `conductor/tests/playwright/track-10032-dispatch-reap-ui.spec.js`, modelled
      on `track-1112-worktree-panel.spec.js`/`track-10024-*.spec.js`: seeds reaped
      dispatches (both the reassign/⟳ and fail/✗ branches, track-scoped and
      project-level) by direct DB write against project 1's own registered
      worker, navigates the real UI, asserts the track panel renders the
      reassignment line (Task 3.3's testid), the control track's unreaped
      dispatch is unchanged (AC-6), the Inbox shows the track under "Needs your
      input", and CICDView shows the marker for both branches on a
      `track_number IS NULL` dispatch. 3/3 passing. Cleaned up in `afterAll`.
      Not added to `SLOW_SPECS` (drives no agent run).
      One deviation from the literal task text worth recording: an unscoped
      text/role locator for the seeded track (e.g. `getByText('#19980')`)
      is ambiguous once the Inbox is open, because the same title/track-number
      text also exists on the Kanban card underneath the slide-over — the
      first attempt hit exactly this (`toClick` timed out, blocked by the
      Inbox's own backdrop, because `.first()` resolved to the occluded board
      card). Fixed by scoping to `[data-testid="track-card"]` for card clicks
      and to the Inbox's own slide-over container for its own assertions.
- [x] Task 5.4: Ran the whole fast tier: `npx playwright test --project=fast`
      — 32/32 passing (all pre-existing specs plus this track's 3 new ones),
      against a scratch API+UI instance built from this worktree's code (see
      Task 5.5).
- [x] Task 5.5: Verified against a **freshly started** scratch instance built
      from this worktree's code (`API_PORT=8191 node server/index.mjs` +
      `SCRATCH_API_PORT=8191 vite --port 8190`), not the shared dev instance
      on 8090/8091 (which runs the pre-this-track main branch and is shared
      with other concurrent sessions — restarting it would have been
      disruptive). This satisfies the same requirement (real boot, real
      `runMigration()`, not a stale process) without touching shared state;
      confirmed the new columns did not exist on the real local DB until this
      boot ran (`\d worker_dispatch` before/after).

**Impact**: The reap path is covered at the level the track asked for — API
response shape and real rendering — not just at the mocked-pool level.

---

## Notes

- **Workspace mode**: classified `**Track Kind**: feature` (see `index.md`). This
  touches the live API server, the UI, and adds a DB migration — with `**Auto
  Run**: yes` it should run on a branch, which is what an inferred `feature`
  resolves to. Do not set `**Workspace**: main` on this one.
- **Migration double-location**: this repo has both a top-level `migrations/`
  (Atlas) and `ui/server/migrations/` (the API's own idempotent boot migrations).
  `runMigration()` reads only the latter — that is where `011_dispatch_reap.sql`
  goes. Adding an Atlas migration too is optional and not required by any
  acceptance criterion.
- **`NODE_TEST_CONTEXT` gotcha**: per `conductor/quality-gate.md`, prefix
  `node --test` invocations with `env -u NODE_TEST_CONTEXT`. `vitest` is unaffected.

## ✅ COMPLETE

All 5 phases implemented and verified:
- 23 new tests (18 mocked-pool + 5 real-DB supertest), all passing, plus
  `track-1102-f18b-dispatch-claim-timeout.test.mjs`'s 5 tests unchanged.
- 3 new Playwright fast-tier tests passing; full fast tier (32/32) passing
  against a freshly booted scratch instance built from this branch (real
  `runMigration()` applied `011_dispatch_reap.sql` to the local DB for the
  first time — confirmed via `\d worker_dispatch` before/after).
- Full `vitest run` diff-confirmed against this branch's own pre-change state
  (via `git stash`): identical 30 pre-existing failures before and after,
  zero regressions.
- `vite build` succeeds.
- Stub/deferred-work scan: no hits in this track's changed files.
