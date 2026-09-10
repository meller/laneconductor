# Spec: POST /track field-parity gap on the cloud collector

## Problem Statement

Filed as track AM-10083's Phase 6 follow-up (Finding F-3). `cloud/functions/index.js`'s
`POST /track` handler (used by remote-api / fire-and-forget-cloud deployments) has a much
narrower insert column list and `ON CONFLICT DO UPDATE` clause than
`ui/server/index.mjs`'s own `POST /track` handler. A project synced to the cloud collector
silently loses every field below — they are never written, with no error anywhere.

Verified by reading both handlers directly (`cloud/functions/index.js:1090-1208` vs.
`ui/server/index.mjs:3091-3380`) rather than relying on the index.md summary alone — two of
the six field names originally listed there turned out not to be simple copy-overs. See
**Planning findings** below.

## Planning Findings (read before implementing)

1. **`waiting_for_reply`, `auto_run`, `merge_mode`, `workspace_mode`, and the 12 KPI columns
   are genuinely missing from cloud** — confirmed absent from both cloud's destructured
   request body and its INSERT/ON CONFLICT clauses. Local's per-field update semantics
   (below) are the copy target.

2. **`model_override` is NOT actually written by local's own `POST /track` handler either.**
   It is set exclusively by a separate, dedicated endpoint —
   `PATCH /api/projects/:id/tracks/:num/model-override` (track 1116), driven by the
   TrackDetailPanel UI dropdown — which itself does not exist on cloud at all (confirmed: no
   `/api/projects/:id/tracks/:num/model-override` route in `cloud/functions/index.js`). That
   missing route is a different gap, in the same family as the two route families track 10052
   already flagged as absent from `cloud/functions/index.js` outright — it is not a
   `POST /track` parity issue and copying local's `POST /track` behavior verbatim would copy
   *nothing*, since local's `POST /track` has no `model_override` handling to copy.

   However: the sync worker (`conductor/laneconductor.sync.mjs:3040`) already parses
   `index.md`'s `**Model**` marker and includes `model_override` in *every* `POST /track`
   payload it sends, to both collectors. Local's `POST /track` currently ignores that field on
   the wire (it relies on the separate PATCH endpoint, and on `syncTrackToFile` writing the
   marker back into `index.md` so the worker's next cycle re-derives the same value — a
   round-trip that happens to converge, not a real write path). Cloud has no such round-trip
   available yet (no PATCH endpoint), so a remote-api deployment cannot set `model_override`
   by any means today.

   **Decision**: bring cloud's `POST /track` up to date to persist `model_override` from the
   payload (COALESCE pattern, same shape as `merge_mode`/`workspace_mode` below). This is a
   deliberate *divergence* from local's `POST /track` (which does nothing with this field) —
   not a parity copy — because it's the only path that lets a remote-api project set this at
   all until the PATCH endpoint is ported. Documented here so a future reader doesn't "fix"
   this back to match local's POST /track and silently break the only way remote-api can set a
   model override.

3. **`log_content` has no backing database column on either collector** — not in
   `prisma/schema.prisma`, not in any file under `migrations/`. The worker
   (`conductor/laneconductor.sync.mjs:2953,3021`) reads `log.md` and includes
   `log_content` in every `POST /track` payload, but **local's own handler doesn't destructure
   or persist it either** — it is silently dropped there today, exactly as on cloud. "Bring
   cloud up to parity with local" is not a well-formed task for this field, because local has
   no behavior to copy.

   **Decision**: excluded from this track's scope. Not implemented here. Left as a
   pre-existing dead field in the worker's payload — worth its own follow-up track to decide
   whether to add a real column + persistence on both collectors, or stop sending it from the
   worker. Noted in Related below so it isn't silently dropped from tracking.

4. **No new migration is needed.** All fields in scope (`waiting_for_reply`, `auto_run`,
   `merge_mode`, `workspace_mode`, `model_override`, and all 12 KPI columns) already exist in
   `prisma/schema.prisma` and have corresponding files under `migrations/`
   (`20260814154139_add_waiting_for_reply.sql`, `20260820095249_add_auto_run.sql`,
   `20260506151159_add_track_type_kpi_fields.sql`, `20260818153000_add_track_model_override.sql`,
   plus the pre-existing `merge_mode`/`workspace_mode` migrations). This is a pure
   application-code change to `cloud/functions/index.js`. The one remaining check is
   operational, not code: confirm the actual deployed cloud Postgres instance has these
   migrations applied before this fix ships (see plan.md Phase 0).

## Requirements

- REQ-1: Cloud's `POST /track` destructures and persists `waiting_for_reply` and `auto_run`
  using the exact same raw-nullable-on-insert / `COALESCE($n, tracks.col)`-on-update pattern
  local uses (`ui/server/index.mjs:3297,3300,3375-3376`) — insert defaults to `false` via
  `COALESCE($n, false)`, an omitted/undefined payload field never clobbers an existing `true`.
- REQ-2: Cloud's `POST /track` destructures and persists `merge_mode` and `workspace_mode`
  using local's raw-nullable (`?? null`) insert + `COALESCE(EXCLUDED.col, tracks.col)` update
  pattern (`ui/server/index.mjs:3304-3306,3377-3378`).
- REQ-3: Cloud's `POST /track` destructures and persists all 12 KPI columns (`track_type`,
  `kpi_target`, `kpi_actual`, `kpi_metric`, `kpi_source`, `kpi_source_config`,
  `kpi_threshold`, `kpi_window`, `kpi_snapshot`, `kpi_measured_at`, `kpi_check_after`,
  `kpi_scheduled_at`, `kpi_maps_to`) with the exact same per-field semantics local uses:
  - `track_type` defaults to `'dev'` on both insert and update
    (`COALESCE(EXCLUDED.track_type, tracks.track_type, 'dev')`).
  - `kpi_snapshot` is `JSON.stringify`-ed before binding, `NULL` when absent.
  - Every KPI field except `kpi_check_after` uses `COALESCE(EXCLUDED.col, tracks.col)` on
    update (an omitted field never clobbers an existing value).
  - `kpi_check_after` is the one exception — local always overwrites it unconditionally
    (`EXCLUDED.kpi_check_after`, no COALESCE) on every sync. Copy this asymmetry exactly; do
    not "fix" it to COALESCE, since that would change working scheduling behavior no one
    asked this track to touch.
- REQ-4: Cloud's `POST /track` destructures and persists `model_override` via
  `COALESCE(EXCLUDED.model_override, tracks.model_override)` (raw-nullable insert). This is a
  deliberate divergence from local's `POST /track` (see Planning Finding 2) — record that
  reasoning as a comment at the call site, matching this repo's convention of leaving a
  "why" comment for non-obvious asymmetries (see the existing `merge_mode`/`workspace_mode`
  comments in `ui/server/index.mjs` for the house style).
- REQ-5: `log_content` is explicitly NOT added in this track (see Planning Finding 3).
- REQ-6: Every new field gets a regression test in the mocked-`pg` harness style of
  `cloud/functions/test/track-10083-post-track-lane-action-status.test.js` (same file, or a
  new sibling `cloud/functions/test/track-10085-post-track-field-parity.test.js` — implementer's
  call, but don't duplicate the existing `mockAuth`/`mockAuthAndExisting`/`basePayload` helpers;
  reuse or extend them). Each field needs at minimum: (a) payload value wins on
  insert, (b) payload value wins on update when supplied, (c) an omitted/undefined payload
  field preserves the existing DB value on update (except `kpi_check_after`, which always
  overwrites — assert that asymmetry too, not just the common case).
- REQ-7: `conductor/tests/cloud-route-parity.test.mjs` continues to pass unchanged — this
  track adds fields to an already-served route, not a new route, so this suite should be
  unaffected. Run it as a sanity check, don't modify it.

## Acceptance Criteria

- [ ] A track synced to the cloud collector with `**Waiting for reply**`, `**Auto Run**`,
      `**Merge Mode**`, `**Workspace**`, and a `## KPI` block set in `index.md`/`spec.md` has
      every one of those values actually present in the row `cloud`'s `POST /track` upserts —
      verified via the mocked-`pg` SQL/param assertions in REQ-6's test file (no real-Postgres
      harness exists for `cloud/functions/index.js`; see that file's own header comment for
      why).
- [ ] `model_override` sent by the worker is persisted by cloud's `POST /track`, with the
      divergence-from-local reasoning recorded as a code comment (REQ-4).
- [ ] `log_content` remains unimplemented on both collectors, with the reasoning captured in
      this file (REQ-5) so a future reader doesn't reopen it as "still missing" without
      re-deriving why.
- [ ] `conductor/tests/cloud-route-parity.test.mjs` still passes.
- [ ] All new/changed tests pass; existing `cloud/functions/test/track-10083-post-track-lane-action-status.test.js`
      tests still pass unmodified (unless REQ-6 extends that same file, in which case its
      existing cases must still pass alongside the new ones).

## Related

- [AM-10083](../AM-10083-lane-action-status-transitions-go-local-only-letting-the-remote-collector-see-a-running-track-as-still-queued/index.md)
  — same collector-parity failure family (F-3), narrower scope (`lane_action_status` only),
  fixed first.
- **Follow-up (not this track)**: `log_content` has no backing column on either collector
  (Planning Finding 3) — worth its own small track to decide add-column-both-sides vs.
  stop-sending-from-worker.
- **Follow-up (not this track)**: `PATCH /api/projects/:id/tracks/:num/model-override`
  (track 1116) does not exist on cloud (Planning Finding 2) — same missing-route family as
  track 10052's Phase 6 callout.
