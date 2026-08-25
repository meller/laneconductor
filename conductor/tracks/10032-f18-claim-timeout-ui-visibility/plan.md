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

- [ ] Task 1.1: Add `ui/server/migrations/011_dispatch_reap.sql` with
      `ALTER TABLE worker_dispatch ADD COLUMN IF NOT EXISTS reaped_at TIMESTAMPTZ NULL;`
      and `... ADD COLUMN IF NOT EXISTS reap_reason TEXT NULL;`
      (`ADD COLUMN IF NOT EXISTS` is mandatory — `runMigration()`
      (`ui/server/index.mjs:2233`) re-runs every file on every boot.)
- [ ] Task 1.2: Extend the stale-selection query to also select `wd.track_number`
      and `wd.action`, and to add `AND wd.reaped_at IS NULL` so an
      already-reaped-but-still-pending dispatch is not reaped (and re-commented on)
      every cycle. **Do not touch** the existing predicates — the staleness window
      (`$1 * INTERVAL '1 millisecond'`), the join, or the phantom exclusion in the
      replacement query; `track-1102-f18b-*.test.mjs` simulates Postgres by
      inspecting this SQL text and will (correctly) fail if a filter is dropped.
- [ ] Task 1.3: Reassign branch — write `reaped_at = NOW()` and `reap_reason` in
      the same `UPDATE` that sets `worker_id`, e.g.
      `reassigned from worker 7 to worker 8 after 300s unclaimed`.
- [ ] Task 1.4: Fail branch — write `reaped_at`/`reap_reason` alongside the
      existing `status='failed'`/`result='timeout: …'` write, in one `UPDATE`.
      Keep `result` as it is today (AC-6: nothing about the current failed
      rendering may regress); `reap_reason` is the copy that survives.
- [ ] Task 1.5: Verify `GET /api/tracks/:id/dispatch` (`SELECT wd.*`) and
      `GET /api/projects/:id/dispatch` (`SELECT wd.*, …`) carry the new fields —
      by hitting the endpoints against a seeded row, not by reading the SQL.

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

- [ ] Task 2.1: In the reaper, for a reaped entry with non-null `track_number`,
      resolve the track id: `SELECT id FROM tracks WHERE project_id = $1 AND
      track_number = $2`. A miss is normal and non-fatal (dispatch for a track
      deleted since) — skip the comment, do not throw.
- [ ] Task 2.2: Insert one `system` comment per reap event, matching the shape
      `POST /api/projects/:id/tracks/:num/comment` uses
      (`ui/server/index.mjs:3159`): `INSERT INTO track_comments(track_id, author,
      body, is_replied) VALUES ($1, 'system', $2, false)`.
      - reassignment → `⚠️ Dispatch <action> was unclaimed for over <N>s — worker
        <id> appears dead; reassigned to worker <id>.`
      - failure → `❌ Dispatch <action> failed: unclaimed for over <N>s and no
        other live worker was available to reassign to.`
      The leading emoji must be the literal first character of the body — that is
      what `/api/inbox`'s `LIKE '⚠️%'` / `LIKE '❌%'` matches on.
- [ ] Task 2.3: `broadcast('track:updated', { projectId, trackNumber })` after a
      track-scoped reap (`broadcast` is already imported at
      `ui/server/index.mjs:14`), so an open board/panel refetches immediately
      rather than waiting out its own poll interval.
- [ ] Task 2.4: Keep every one of the above inside the existing per-entry
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

- [ ] Task 3.1: In the strip's marker logic, branch on `d.reap_reason` **before**
      the `status` branches for the pending case: render an amber `⟳` when
      `reap_reason` is set and `status !== 'failed'`; keep the red `✗` for
      `failed` (which now also carries a `reap_reason`).
- [ ] Task 3.2: Render the reason text on the row and put the full string in
      `title=` (the row is `truncate`d — the existing `d.result` rendering already
      does this and is the pattern to follow).
- [ ] Task 3.3: Add a stable `data-testid` (e.g. `dispatch-reaped-<id>`) so
      Phase 5's browser check has something non-brittle to assert on.
- [ ] Task 3.4: Confirm the existing `✓ done` / `✗ failed` / `•` rendering is
      untouched for rows with `reap_reason == null` (AC-6).

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

- [ ] Task 4.1: Render the reaped marker + reason in `DispatchHistory`'s row,
      matching Phase 3's treatment (amber `⟳`, reason in `title`).
- [ ] Task 4.2: Confirm the reaper produces no error and no orphan comment for a
      `track_number IS NULL` dispatch (Task 2.1's null guard), by reaping a seeded
      deploy dispatch and checking `ui/.api.log`.

**Impact**: The one class of dispatch with no track to fall back on stops being
silently reaped.

---

## Phase 5: Real test coverage

**Problem**: The track was filed asking for *real* coverage — an API-level proof
that the response carries the reason, plus a live browser check that it renders.
Unit tests over a mocked pool (which is all track 1102 has) cannot show either.

**Solution**: Two tiers, mirroring what already exists in this repo.

- [ ] Task 5.1: Extend
      `ui/server/tests/track-1102-f18b-dispatch-claim-timeout.test.mjs`'s mocked-pool
      pattern in a **new** file
      `ui/server/tests/track-10032-dispatch-reap-visibility.test.mjs` — do not
      rewrite 1102's file. Cover: `reap_reason` written on the reassign branch;
      written on the fail branch; the `reaped_at IS NULL` predicate present in the
      stale-selection SQL (mutation-safe — assert on the SQL text the way 1102's
      file does, so dropping the filter fails the test); one `track_comments`
      insert per track-scoped reap; **zero** inserts when `track_number` is null.
- [ ] Task 5.2: New API-level test proving the response payload carries the
      reason: seed a stale dispatch, run the reaper against a real pool, assert
      `GET /api/tracks/:id/dispatch` and `GET /api/projects/:id/dispatch` include
      `reap_reason`. Use `supertest` against the exported `app` (the pattern
      `ui/server/tests/api-routes.test.mjs` already uses) rather than a live
      server, so it runs in the fast, hermetic tier.
- [ ] Task 5.3: New Playwright **fast-tier** spec
      `conductor/tests/playwright/track-10032-dispatch-reap-ui.spec.js`, modelled
      on `track-1112-worktree-panel.spec.js`: seed a reaped dispatch by direct DB
      write against project 1's own registered worker, navigate the real UI,
      assert the track panel renders the reassignment line (Task 3.3's testid) and
      that the Inbox shows the track under "Needs your input". Clean up the seeded
      rows in `afterAll` exactly as 1112's spec does.
      New specs default into the `fast` project (see `playwright.config.js`) — do
      **not** add this to `SLOW_SPECS`; it drives no agent run.
- [ ] Task 5.4: Run the whole fast tier, not just the new spec:
      `npx playwright test --project=fast`.
- [ ] Task 5.5: **Restart the API server before any of the browser/API
      verification** — `ui/server/index.mjs` does not hot-reload, and this project
      has produced several false passes from verifying against a stale process
      (see `conductor/quality-gate.md`). Same for the migration: the new column
      only exists after a boot that ran `runMigration()`.

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
