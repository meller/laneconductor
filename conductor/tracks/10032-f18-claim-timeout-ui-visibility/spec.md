# Spec: Track 10032 — F18 claim-timeout, surface the outcome in the UI

## Problem Statement

Track 1102's Phase 12 added `reapStaleDispatches()` (`ui/server/index.mjs:1786`,
wired to a `setInterval` at `ui/server/index.mjs:4720`). A `worker_dispatch` row
left `pending` past `LC_DISPATCH_CLAIM_TIMEOUT_MS` (default 300 000 ms) is either:

- **reassigned** — `UPDATE worker_dispatch SET worker_id = <replacement>`, or
- **failed** — `UPDATE worker_dispatch SET status = 'failed', result = 'timeout: …'`

Both outcomes are announced only to `console.warn` on the API process
(`[dispatch-reaper] …`, which lands in `ui/.api.log` / the Pinorama viewer). Neither
reaches the user:

1. **Reassignment leaves no trace at all.** The row's `status` stays `'pending'`,
   only `worker_id` changes. `GET /api/tracks/:id/dispatch` returns the row, but
   the track detail panel's history strip (`TrackDetailPanel.jsx:953–970`) renders
   `• <action> <time>` for anything not `done`/`failed`/`claimed` — visually
   identical before and after a reassignment. The user cannot tell a worker died.
2. **The failure case is only half-surfaced, and only if you already opened that
   track.** The strip does render `d.result`, so `✗ implement 14:32 — timeout: …`
   would appear — but only inside the track detail panel, only in the top 3 rows,
   and only for `track_number IS NOT NULL` dispatches. Nothing pulls the user's
   attention there.
3. **Non-track dispatches are invisible.** `deploy`, `create-project`, `set_model`
   and chat dispatches carry `track_number IS NULL`, so they have no track panel
   at all. `CICDView`'s `DispatchHistory` (`CICDView.jsx:270`) lists project-level
   ones, but there is nothing marking a reaped row as reaped.

Net effect: the safety net that track 1102 built works, and a user only learns it
fired by running `psql` or grepping `ui/.api.log`.

## Solution

Layered, cheapest-first, using affordances that already exist:

1. **Record the reap outcome durably on the dispatch row** (new nullable columns),
   so both outcomes have something renderable and neither is overwritten when the
   worker later PATCHes `status`/`result` on completion.
2. **Annotate the dispatch history** — per-track strip and project-level CI/CD
   history — so the detail is where a user investigating that track/deploy looks.
3. **Push a track-scoped reap into the Inbox** as a `system` comment, so the user
   is told without having to already be looking at the right panel. The Inbox's
   `needs_input` bucket already keys on a `system` comment whose body starts with
   `⚠️`/`❌` (`ui/server/index.mjs:999`) — no new UI surface, no new plumbing.

### Why not a toast

There is no toast/notification infrastructure in this app (verified: zero
`toast`/`Toast` references under `ui/src`). Building one for this would be new
infra for an event that fires on a ≥5-minute timescale, server-side, almost always
while nobody has the relevant panel open — a toast would be missed by construction.
The Inbox is this project's existing answer to "tell the user something happened
while they weren't looking", and it persists.

### Why not just `result` for the reassignment case

Writing `result` on a still-`pending` dispatch is safe (the worker reads only
`action`/`payload` from `/worker/:id/dispatch`) but ephemeral — `PATCH
/worker/dispatch/:id` (`ui/server/index.mjs:3691`) overwrites `result` the moment
the reassigned worker finishes the run, erasing the very evidence this track
exists to preserve. Dedicated columns survive that.

## Requirements

- **REQ-1** — `worker_dispatch` gains two nullable columns, added by a new
  idempotent migration `ui/server/migrations/011_dispatch_reap.sql` (`ADD COLUMN IF
  NOT EXISTS`, matching `010_workspace_mode.sql`'s style, since `runMigration()`
  re-runs every file on every boot):
  - `reaped_at timestamptz NULL`
  - `reap_reason text NULL`
- **REQ-2** — `reapStaleDispatches()` sets both columns on **both** branches:
  - reassigned → `reap_reason` = human-readable, naming the timeout, the dead
    worker and the replacement (e.g. `reassigned from worker 7 to worker 8 after
    300s unclaimed`)
  - failed → `reap_reason` set alongside the existing `status='failed'` +
    `result='timeout: …'` write (the two must not diverge; `reap_reason` is the
    one that survives)
- **REQ-3** — the stale-selection query additionally selects `wd.track_number` and
  `wd.action`, which the current query does not (needed for REQ-5's comment and
  for the reason text). The existing WHERE clauses — staleness window, phantom
  exclusion (`pid != 0`, `hostname NOT LIKE 'pw-e2e-%'`), project scoping — must
  not change; track-1102's own tests assert on the SQL text.
- **REQ-4** — both `GET /api/tracks/:id/dispatch` and `GET
  /api/projects/:id/dispatch` return the new columns (both already `SELECT wd.*` /
  `SELECT *`, so this should need no query change — verify rather than assume).
- **REQ-5** — for a reaped dispatch with a non-null `track_number` that resolves
  to a real track in the same project, the reaper inserts one `system` comment
  into `track_comments`:
  - reassignment → body starts with `⚠️` (a worker went dark; the run was rescued
    but the machine needs a look) → Inbox `needs_input`
  - failure → body starts with `❌` → Inbox `needs_input`
  - Exactly one comment per reap event — the reaper must not re-comment on a row
    it already reaped (`reaped_at IS NULL` guard in the stale-selection query).
- **REQ-6** — after a reap that touched a track, `broadcast('track:updated', {
  projectId, trackNumber })` fires, so an open board/panel refetches rather than
  waiting out its own 4 s/5 s poll.
- **REQ-7** — `TrackDetailPanel`'s dispatch history strip renders a distinct
  reaped state: an amber `⟳` marker for a reassignment (which is otherwise
  indistinguishable from a healthy pending dispatch) and the `reap_reason` text,
  with the full reason in the `title` tooltip. The existing `done`/`failed`/
  `claimed` rendering must not regress.
- **REQ-8** — `CICDView`'s `DispatchHistory` renders the same reaped marker for
  project-level (`track_number IS NULL`) dispatches, which have no track panel and
  get no Inbox comment — this is their only surface.
- **REQ-9** — a reap failure (bad SQL, missing track, comment insert error) must
  not abort the reap loop for the remaining stale rows. The existing per-entry
  `try/catch` covers this; the comment insert goes inside it.

## Non-Requirements (explicitly out of scope)

- No toast/notification-centre infrastructure (see rationale above).
- No change to the reap **policy** — the timeout window, the phantom-worker
  exclusion, and the reassign-else-fail decision are track 1102's and stay as-is.
  This track only makes the outcome visible.
- No backfill of `reap_reason` for dispatches reaped before this migration; those
  rows keep `NULL` and render exactly as they do today.

## Data Model Changes

```sql
-- ui/server/migrations/011_dispatch_reap.sql
ALTER TABLE worker_dispatch ADD COLUMN IF NOT EXISTS reaped_at   TIMESTAMPTZ NULL;
ALTER TABLE worker_dispatch ADD COLUMN IF NOT EXISTS reap_reason TEXT NULL;
```

Both nullable, no default, no index — the reaper's selection query filters on
`status`/`created_at` (already covered by `idx_worker_dispatch_worker_status` plus
a sequential scan on a small table), and `reaped_at IS NULL` is only an additional
predicate on an already-narrow result set.

## Acceptance Criteria

Every criterion below is stated as something a user can observe. None of them is
satisfiable by a stub.

- [ ] **AC-1** — A worker is assigned a lane-action dispatch and then dies before
      claiming it, while another live worker exists for the project. After the
      claim timeout, the track's detail panel shows an amber reassignment line in
      its dispatch history naming both workers — without a page reload beyond the
      panel's own refresh.
- [ ] **AC-2** — Same scenario with **no** other live worker: the track's detail
      panel shows the dispatch as failed with the timeout reason, and the reason
      is still readable after the row is later touched by any subsequent worker
      PATCH.
- [ ] **AC-3** — In both AC-1 and AC-2, the track appears in the Inbox's "Needs
      your input" section with the `⚠️`/`❌` summary — reachable from the board
      without opening the track first.
- [ ] **AC-4** — A reaped *deploy* dispatch (no track number) shows the reaped
      marker in the CI/CD view's dispatch history. It produces no Inbox comment
      (there is no track to comment on) and no error in `ui/.api.log`.
- [ ] **AC-5** — The reaper leaves a dispatch it has already reaped alone: a
      reassigned-but-still-unclaimed dispatch does not accumulate a second Inbox
      comment on the next reap cycle.
- [ ] **AC-6** — Dispatches that were never reaped render exactly as they do
      today (`✓ done` / `✗ failed` / `•` pending), in both the track strip and
      the CI/CD history.
- [ ] **AC-7** — On a database that predates this track, the API boots, applies
      `011_dispatch_reap.sql` idempotently, and both dispatch history endpoints
      answer 200 with the new fields present (`null` for old rows).

## Open Items for Human Review

None. Nothing here conflicts with `conductor/product.md`, `tech-stack.md`,
`design-language.md` or `workflow.md` — it reuses the existing `system`-comment /
Inbox convention documented in the skill's **Completion Comment Convention**, the
existing `ui/server/migrations/` mechanism, and the existing dispatch-history
components.
