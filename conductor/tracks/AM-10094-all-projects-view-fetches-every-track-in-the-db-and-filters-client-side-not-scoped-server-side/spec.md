# Spec: All Projects view fetches every track in the DB and filters client-side

## Problem Statement

The Projects overview renders per-project lane-count chips and an unreplied
badge. To do that it eagerly fetches **every track row in the entire
install** on a fixed short interval, then splits the result per project in
the browser (`ProjectCard.jsx:34`, `tracks.filter(t => t.project_id ===
project.id)`).

Measured on the live local database (738 tracks, 19 projects, 14,191
comments) during planning:

| Measurement | Value |
|---|---|
| `GET /api/tracks` wall clock | 1.66 s |
| `GET /api/tracks` payload | 850 KB |
| Poll interval, websocket down | 2 s |
| Poll interval, websocket up | 30 s |

The endpoint takes longer to answer than the interval it is polled on, so
with the websocket down the server never finishes one request before the
next is wanted.

### Root cause is not the one the track was filed on

The track was filed believing the cost is the query *shape* (a join over
all rows with no `LIMIT`), and that the project-scoped path
(`GET /api/projects/:id/tracks`) is "genuinely server-scoped ... efficient
and does not need fixing". Measurement contradicts the second half of that
and reorders the first.

**`track_comments` has no index on `track_id`.** Its only index is the
primary key on `id`:

```
Indexes:
    "track_comments_pkey" PRIMARY KEY, btree (id)
```

Every correlated `LATERAL` in these handlers filters on `track_id`, so each
one sequentially scans all 14,191 comment rows, once per track row, per
subquery. `EXPLAIN ANALYZE` on the unscoped query shows the same
`Seq Scan on track_comments` repeated with `loops=738` and
`Rows Removed by Filter: 14172`.

Adding that one index, measured in a rolled-back transaction against the
real data:

| Query | Now | With index |
|---|---|---|
| Unscoped `/api/tracks` | 1630 ms | 46 ms |

The same defect is what makes the supposedly-fine scoped path slow too:
`GET /api/projects/:id/tracks` for project 1 (203 tracks) measures **394
ms**, because scoping reduces the number of `LATERAL` iterations but not
the full-table scan each one performs. That path is
O(tracks_in_project x comments_in_whole_install), not O(tracks_in_project).
It needs the same fix, and the index delivers it for free.

So there are three separable defects, in descending order of leverage:

1. **Missing index** on `track_comments(track_id)`. One migration, 36x on
   the unscoped query, and it also repairs the scoped endpoint and
   `/api/inbox`, which share the same correlated-subquery pattern
   (`HUMAN_NEEDS_REPLY_SQL` is referenced at three call sites).
2. **Correlated per-row aggregation** where a single set-based pass would
   do. A `GROUP BY` summary computing the same per-project counts measures
   **7 ms** and needs no index at all.
3. **Payload shape.** 850 KB of full per-track rows is shipped to render
   lane-count chips that need roughly 2 KB of aggregates.

### What a summary endpoint does and does not fix

The track proposes a summary endpoint so the overview stops requesting the
full list. That is correct and worth doing, but it does not remove the
unscoped fetch, because the overview is not the only consumer.

`selectedProjectId` initialises to `null` (`App.jsx:116`) and `viewMode`
initialises to `'lanes'` on desktop (`App.jsx:147`). **The default desktop
landing view is therefore the all-projects Kanban board**, which renders
every track across every project and genuinely needs per-track rows. A
summary endpoint only helps `viewMode === 'projects'`.

This is why Phase 1 leads. The index is what makes the default landing view
acceptable; the summary endpoint is what stops the overview page paying for
data it never displays.

### Regression surface, verified

The track asks that the fix not regress the inbox badge or the KPI rollup.
Both were checked:

- **Inbox badge** (`App.jsx:187`) sums `unreplied_count` across the
  all-projects `tracks` array. It is a real dependency and must be fed from
  the summary endpoint's per-project `unreplied_total` whenever the full
  list is not fetched. This is a genuine regression risk and is covered by
  its own acceptance criterion.
- **KPI rollup** is *already inert* in all-projects mode and cannot
  regress. `KpiRollupPanel` returns `null` unless a track carries both
  `kpi_maps_to` and `kpi_target`, and the unscoped `/api/tracks` `SELECT`
  list does not include any `kpi_*` column (the project-scoped handler
  does). It renders nothing there today, before any change.

## Requirements

- **REQ-1**: Add a database index on `track_comments(track_id)` via a
  timestamped migration in `migrations/`, matching the existing convention,
  and declare it in `prisma/schema.prisma` so the declarative schema and
  the applied schema agree.
- **REQ-2**: Add `GET /api/projects/summary` returning one row per project
  with `project_id`, `name`, per-lane counts, `total`, and
  `unreplied_total`, computed by set-based aggregation in a single query —
  not by per-row correlated subqueries.
- **REQ-3**: The summary endpoint must respect the same visibility rules
  `GET /api/projects` already applies: the meta project
  (`META_PROJECT_REPO_PATH`) is excluded, and under `AUTH_ENABLED` only
  projects the requesting user is a member of are returned.
- **REQ-4**: `ProjectsPage` / `ProjectCard` consume summary rows instead of
  filtering a full track array. A project with no tracks still renders its
  card with a zero state.
- **REQ-5**: While the Projects overview is showing, the unscoped
  `GET /api/tracks` is not requested. Selecting a project, or switching to
  any view that renders tracks, restores the existing fetch behaviour.
- **REQ-6**: The inbox badge count stays correct in the Projects overview,
  fed from the summary endpoint's `unreplied_total`.
- **REQ-7**: Trim the unscoped `/api/tracks` payload by truncating the two
  free-text columns the UI already clamps visually — `last_comment_body`
  (19.0% of payload) and `content_summary` (13.3%). Every consumer renders
  them clamped (`line-clamp-3`, `line-clamp-2`, `.slice(0, 120)`), and
  `/api/inbox`, which classifies on the comment body, is a separate handler
  and is not touched.
- **REQ-8**: Verify at realistic scale. The 738-track / 19-project / 14,191-
  comment local database is the floor, and before/after timings must be
  recorded from `EXPLAIN ANALYZE` and real HTTP requests, not estimated.

## Non-Goals

- **Paginating or virtualising the all-projects Kanban board.** That view
  legitimately renders every track, so a `LIMIT` would drop cards the user
  asked to see. With REQ-1 in place it answers in ~46 ms, which is
  adequate. Changing how that board is loaded is a UX decision, not a
  performance fix, and belongs in its own track.
- Changing the poll intervals or the websocket coalescing logic.
- Reworking `HUMAN_NEEDS_REPLY_SQL` itself. REQ-1 makes it cheap; rewriting
  it set-based across all three call sites is a larger refactor with its own
  correctness risk.

## Acceptance Criteria

- [ ] AC-1: On the live 738-track dataset, `GET /api/tracks` responds in
      under 150 ms, measured with a real HTTP request against a restarted
      API server. (Baseline: 1.66 s.)
- [ ] AC-2: `GET /api/projects/:id/tracks` for the largest project (id 1,
      203 tracks) responds in under 100 ms. (Baseline: 394 ms.)
- [ ] AC-3: `GET /api/projects/summary` returns one row per visible project
      with correct counts, verified by comparing every row against the
      counts derived independently from `GET /api/tracks`.
- [ ] AC-4: Opening the Projects overview in a browser issues no request to
      `/api/tracks`, confirmed from the network panel or server log across
      at least two poll cycles.
- [ ] AC-5: The lane-count chips and unreplied counts rendered on each
      project card in the overview are identical to what the current build
      renders for the same data.
- [ ] AC-6: The inbox badge shows the same total in the Projects overview as
      it does in the all-projects board view.
- [ ] AC-7: A project with zero tracks renders its card with the existing
      "No tracks yet" zero state.
- [ ] AC-8: The `/api/tracks` payload is at least 25% smaller than the
      850 KB baseline, and track cards still render their comment preview
      and summary text with no visible truncation beyond the existing clamp.
- [ ] AC-9: `cd ui && npm test` passes, including new tests for the summary
      endpoint and the overview's data source.

## API Contracts

### `GET /api/projects/summary`

```json
[
  {
    "project_id": 1,
    "name": "laneconductor",
    "total": 203,
    "unreplied_total": 12,
    "lane_counts": {
      "plan": 4, "backlog": 11, "implement": 2,
      "review": 1, "quality-gate": 0, "done": 185
    }
  }
]
```

Lanes absent from a project are omitted from `lane_counts` or present as
zero; `ProjectCard` already filters to lanes with a count above zero.

## Data Model Changes

One additive index, no column or table changes:

```sql
CREATE INDEX "idx_track_comments_track_id" ON "public"."track_comments" ("track_id");
```

`prisma/schema.prisma`'s `track_comments` model gains the matching
`@@index([track_id])`.
