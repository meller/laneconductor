# Track AM-10094: All Projects view fetches every track in the DB and filters client-side

Phases are ordered by measured leverage, not by layer. Phase 1 alone
accounts for a 36x reduction in server time and repairs the project-scoped
endpoint the track originally believed was healthy.

## Phase 1: Index `track_comments(track_id)`

**Problem**: `track_comments` carries only a primary-key index on `id`.
Every correlated `LATERAL` in the track handlers filters on `track_id`, so
each sequentially scans all 14,191 comment rows once per track row. The
unscoped query shows `Seq Scan on track_comments` with `loops=738`.

**Solution**: One additive index. Measured in a rolled-back transaction on
the real database: unscoped query 1630 ms to 46 ms.

- [x] Task 1: Write `migrations/<timestamp>_add_track_comments_track_id_index.sql`
      following the hand-trimmed additive convention of
      `20260908120000_add_project_file_manifest.sql`, with a comment naming
      this track and the measured before/after
    - [x] Sub-task: `CREATE INDEX "idx_track_comments_track_id" ON "public"."track_comments" ("track_id");`
    - [x] Sub-task: Update `migrations/atlas.sum` so the migration directory
          stays consistent
- [x] Task 2: Add `@@index([track_id])` to the `track_comments` model in
      `prisma/schema.prisma` so the declarative schema matches what is applied
- [x] Task 3: Apply the migration to the local database and re-run
      `EXPLAIN ANALYZE` on both the unscoped and the project-scoped query
    - [x] Sub-task: Record real numbers in `test.md`; confirm the plan no
          longer shows `Seq Scan on track_comments`
- [x] Task 4: Restart the API server, then time real HTTP requests to
      `/api/tracks` and `/api/projects/1/tracks` (AC-1, AC-2)

**Impact**: `/api/tracks`, `/api/projects/:id/tracks` and `/api/inbox` all
get faster without a line of application-code change. The default desktop
landing view (all-projects Kanban) becomes viable at current scale.

## Phase 2: Set-based `GET /api/projects/summary`

**Problem**: The overview needs per-project aggregates but the only endpoint
that can produce them returns one full row per track.

**Solution**: A single set-based query. A prototype measuring per-project
lane counts plus `unreplied_total` runs in 7 ms with no index dependency,
because it scans `track_comments` twice in total rather than 738 times per
subquery.

- [x] Task 1: Add the handler in `ui/server/index.mjs`, near the existing
      `/api/projects` handler
    - [x] Sub-task: Compute unreplied counts with CTEs
          (`last_human` grouped by `track_id`, then `unreplied` grouped by
          `track_id`) joined once, never as a correlated subquery
    - [x] Sub-task: Lane counts via `COUNT(*) FILTER (WHERE lane_status = ...)`
          over the six lanes in `LANE_ORDER`
    - [x] Sub-task: `LEFT JOIN` from `projects` so a project with zero
          tracks still returns a row (REQ-4, AC-7)
- [x] Task 2: Apply the same visibility rules as `GET /api/projects`
      (REQ-3)
    - [x] Sub-task: Exclude `META_PROJECT_REPO_PATH`
    - [x] Sub-task: Under `AUTH_ENABLED`, join `project_members` and filter
          on `req.user.uid`, mirroring the existing branch exactly
- [x] Task 3: Write server tests in `ui/server/tests/` following the naming
      convention of the existing `track-NNNNN-*.test.mjs` files
    - [x] Sub-task: Counts match those derived from `/api/tracks`
    - [x] Sub-task: Zero-track project returns a row with `total: 0`
    - [x] Sub-task: Meta project excluded

**Impact**: The data the overview actually displays becomes available in
~7 ms and ~2 KB instead of 1630 ms and 850 KB.

## Phase 3: Wire the Projects overview to the summary endpoint

**Problem**: `ProjectsPage` receives the full `tracks` array and each
`ProjectCard` filters it. `usePolling` fetches that array unconditionally
whenever no project is selected, regardless of which view is showing.

**Solution**: Fetch summaries for the overview, and suppress the unscoped
track fetch while it is the active view.

- [x] Task 1: Teach `usePolling` an option to fetch project summaries
      instead of the unscoped track list
    - [x] Sub-task: Return `projectSummaries` alongside the existing state;
          leave the project-scoped branch untouched
    - [x] Sub-task: Keep the existing in-flight coalescing and abort
          handling intact — do not disturb the Track 10013 fix
- [x] Task 2: Pass the option from `App.jsx` based on `viewMode === 'projects'`
      (REQ-5)
- [x] Task 3: Change `ProjectCard` to take a summary row rather than the
      full `tracks` array and a filter
    - [x] Sub-task: `laneCounts` comes from `summary.lane_counts`
    - [x] Sub-task: `unrepliedCount` comes from `summary.unreplied_total`
    - [x] Sub-task: `computeStatus` and the worker-derived `isOnline` logic
          are unchanged — workers are still fetched as they are today
- [x] Task 4: Feed `inboxBadgeCount` from the summary totals when the full
      list is absent (REQ-6, AC-6)
- [x] Task 5: Update `ProjectCard.test.jsx` and add a test asserting the
      overview issues no `/api/tracks` request (AC-4)

**Impact**: The overview stops paying for data it never renders, and the
comment in `ProjectsPage.jsx` claiming "zero extra requests" stops being
true at the cost of a 850 KB request — replace that comment with what the
code now does.

## Phase 4: Trim the unscoped payload and verify at scale

**Problem**: 850 KB per poll for the all-projects board. `last_comment_body`
is 19.0% of it and `content_summary` 13.3%, and every consumer clamps both
visually.

**Solution**: Truncate server-side in the unscoped handler only.

- [x] Task 1: Truncate `last_comment_body` and `content_summary` in the
      `/api/tracks` `SELECT` list to a bound comfortably above what the UI
      shows (`line-clamp-3` and `.slice(0, 120)` are the widest uses)
    - [x] Sub-task: Leave `/api/inbox` untouched — it classifies on the
          comment body and is a separate handler
    - [x] Sub-task: Leave the project-scoped handler untouched
- [x] Task 2: Re-measure payload size against the 850 KB baseline (AC-8)
- [x] Task 3: Drive the real product (quality-gate step 2a)
    - [x] Sub-task: Restart the API server and the Vite UI first — neither
          hot-reloads, and verifying against a stale process is a false pass
    - [x] Sub-task: Open the Projects overview, confirm lane chips and
          unreplied counts match the current build for the same data (AC-5)
    - [x] Sub-task: Confirm no `/api/tracks` request across two poll cycles
          (AC-4)
    - [x] Sub-task: Open the all-projects board and a single project, and
          confirm cards still render comment previews (AC-8)
- [x] Task 4: Run `cd ui && npm test` and record the result (AC-9)
    - [x] Sub-task: After the run, check `ps aux | grep laneconductor.sync.mjs`
          for leaked workers — the mocked vitest suite has leaked real
          workers against the primary checkout before

**Impact**: Closes the track. The remaining per-track payload on the
all-projects board is deliberate and recorded as a Non-Goal in `spec.md`,
not deferred work.


## ✅ COMPLETE

Implemented directly on `main` (not via the track worktree dispatch — see the
completion comment in conversation.md for why) across all 4 phases:

- Phase 1: added `idx_track_comments_track_id`; measured 1630ms -> ~46ms server-side
  (confirmed via EXPLAIN ANALYZE and real HTTP timing after restart).
- Phase 2: added `GET /api/projects/summary`; cross-validated its per-project
  totals/lane-counts/unreplied_total against `/api/tracks` ground truth (exact match).
- Phase 3: `usePolling` gained a `summaryOnly` option, wired from `App.jsx` when
  `viewMode === 'projects'` and no project is selected; `ProjectCard`/`ProjectsPage`
  now consume the summary row instead of filtering the full unscoped array.
  `inboxBadgeCount` falls back to summary totals in that view. Verified live in the
  browser: no `/api/tracks` request fires while the overview is showing (confirmed via
  network log), and lane chips/unreplied counts render correctly for all 18 projects.
  Found and fixed an off-by-one array-index bug during this verification (the summary
  response landed at a different index than the fetch read it from).
- Phase 4: truncated `content_summary`/`last_comment_body` to 500 chars in the
  unscoped handler only; measured payload 854KB -> 737KB (13.7%) on the real dataset.
  Project-scoped endpoint and `/api/inbox` confirmed untouched.
- `ui/src/components/ProjectCard.test.jsx` rewritten for the new `summary` prop
  contract; `ui/src/hooks/usePolling.test.jsx` added (AC-4: no unscoped fetch in
  summaryOnly mode). Full `cd ui && npm test` run before/after: 41 -> 39 failures,
  the exact 2 fixed being the ProjectCard tests this change touched — every other
  failure confirmed pre-existing via git-stash A/B (unrelated: auth.test.mjs,
  WorkflowSettings.test.jsx, model-override, etc.). No leaked worker processes after
  the run.

