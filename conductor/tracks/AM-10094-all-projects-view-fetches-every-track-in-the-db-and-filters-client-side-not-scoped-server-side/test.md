# Tests: Track AM-10094 — All Projects view fetches every track in the DB

## Baseline (measured during planning, 2026-09-12)

Live local database: 738 tracks, 19 projects, 14,191 comments.

| What | Baseline |
|---|---|
| `EXPLAIN ANALYZE` unscoped tracks query | 1630 ms |
| `EXPLAIN ANALYZE` same query, index added in rolled-back txn | 46 ms |
| `EXPLAIN ANALYZE` project-scoped (project 1, 203 tracks) | 394 ms |
| `EXPLAIN ANALYZE` set-based summary prototype | 7 ms |
| `GET /api/tracks` HTTP | 1.66 s / 850 KB |
| `last_comment_body` share of payload | 19.0% |
| `content_summary` share of payload | 13.3% |

Re-measure each of these after the change and record the result beside the
baseline. A number that was not observed in this run does not count.

## Test Commands

```bash
# Server + UI unit/integration suite
cd ui && npm test

# Single server test file
cd ui && npx vitest run server/tests/track-10094-projects-summary.test.mjs

# Query timings against the live DB
PGPASSWORD=postgres psql -h localhost -U postgres -d laneconductor \
  -c "EXPLAIN (ANALYZE, BUFFERS) <query>"

# Real HTTP timing and payload size
curl -s -o /tmp/tracks.json -w "http=%{http_code} bytes=%{size_download} time=%{time_total}\n" \
  http://127.0.0.1:8091/api/tracks
curl -s -o /dev/null -w "time=%{time_total}\n" http://127.0.0.1:8091/api/projects/1/tracks
curl -s http://127.0.0.1:8091/api/projects/summary | head -c 400
```

**Before any HTTP timing**: restart the API server. It does not hot-reload,
and timing a process started before the change measures the old code.

**After any full vitest run**: check `ps aux | grep laneconductor.sync.mjs`
for leaked workers against the primary checkout, and kill any found.

## Test Cases

### Phase 1: Index on `track_comments(track_id)`

- [ ] TC-1: `\d track_comments` lists `idx_track_comments_track_id` —
      expected: index present after migration
- [ ] TC-2: `EXPLAIN ANALYZE` of the unscoped tracks query contains no
      `Seq Scan on track_comments` — expected: index scans throughout
- [ ] TC-3: Unscoped query execution time under 150 ms — expected: ~46 ms
      (baseline 1630 ms) — AC-1
- [ ] TC-4: Project-scoped query for project 1 under 100 ms — expected:
      well under (baseline 394 ms) — AC-2
- [ ] TC-5: `prisma/schema.prisma` declares `@@index([track_id])` on
      `track_comments` — expected: declarative schema matches applied schema
- [ ] TC-6: `GET /api/inbox` returns the same rows as before the migration —
      expected: identical output, faster; the index changes plans, not results

### Phase 2: `GET /api/projects/summary`

- [ ] TC-7: Endpoint returns one row per visible project — expected: row
      count equals `GET /api/projects` row count — AC-3
- [ ] TC-8: For every project, `lane_counts` equals the counts derived by
      grouping `GET /api/tracks` by `project_id` and `lane_status` —
      expected: exact match on all 19 projects — AC-3
- [ ] TC-9: For every project, `unreplied_total` equals the sum of
      `unreplied_count` over that project's tracks from `GET /api/tracks` —
      expected: exact match — AC-3
- [ ] TC-10: A project with zero tracks appears with `total: 0` and empty
      or all-zero `lane_counts` — expected: row present, not omitted — AC-7
- [ ] TC-11: The meta project (`META_PROJECT_REPO_PATH`) is absent —
      expected: excluded, same as `GET /api/projects` — REQ-3
- [ ] TC-12: With `AUTH_ENABLED`, a user sees only projects they are a
      member of — expected: same filtering as `GET /api/projects` — REQ-3
- [ ] TC-13: Endpoint execution time under 50 ms on the 738-track dataset —
      expected: ~7 ms
- [ ] TC-14: Response payload under 10 KB — expected: ~2 KB (baseline for
      the data it replaces: 850 KB)

### Phase 3: Projects overview consumes the summary

- [ ] TC-15: With `viewMode === 'projects'`, no request to `/api/tracks` is
      issued across at least two poll cycles — expected: absent from the
      network panel and the API server log — AC-4
- [ ] TC-16: Selecting a project restores the project-scoped track fetch —
      expected: `/api/projects/:id/tracks` requested as before — REQ-5
- [ ] TC-17: Switching from the overview to the all-projects board restores
      the unscoped fetch — expected: `/api/tracks` requested again — REQ-5
- [ ] TC-18: `ProjectCard` renders lane chips from a summary row, with the
      same labels, colours and ordering as the current build for the same
      data — expected: visually identical — AC-5
- [ ] TC-19: `ProjectCard` unreplied count matches the current build —
      expected: identical number and the same `project-unreplied-count`
      test id — AC-5
- [ ] TC-20: A zero-track project renders the "No tracks yet" zero state —
      expected: unchanged from today — AC-7
- [ ] TC-21: `computeStatus` still returns `offline` / `attention` /
      `active` / `idle` on the same inputs — expected: status badge
      unchanged, since worker data is still fetched as before
- [ ] TC-22: Inbox badge in the Projects overview equals the badge shown in
      the all-projects board for the same data — expected: identical
      total — AC-6
- [ ] TC-23: The existing `usePolling` in-flight coalescing still holds
      (Track 10013) — expected: `loading` clears after the first successful
      round trip under a burst of websocket events

### Phase 4: Payload trim and real-product verification

- [ ] TC-24: `GET /api/tracks` payload at least 25% below the 850 KB
      baseline — expected: roughly 550-600 KB — AC-8
- [ ] TC-25: Track cards on the all-projects board still show a comment
      preview and summary text — expected: no visible change, both were
      already clamped — AC-8
- [ ] TC-26: `GET /api/inbox` comment bodies are untruncated — expected:
      unchanged; its emoji classification reads the full body
- [ ] TC-27: Project-scoped `GET /api/projects/:id/tracks` bodies are
      untruncated — expected: unchanged, only the unscoped handler is
      modified
- [ ] TC-28: Real-product drive-through with the API server and Vite UI
      restarted first — expected: overview, all-projects board and a single
      project all render correctly; record the observation

## Acceptance Criteria

- [ ] All test cases above pass with observed output, not inferred
- [ ] `cd ui && npm test` passes — AC-9
- [ ] No regressions in `/api/inbox`, the project-scoped track endpoint, or
      the all-projects Kanban board
- [ ] Before/after numbers recorded in this file from real runs
- [ ] No leaked `laneconductor.sync.mjs` workers after the test run
