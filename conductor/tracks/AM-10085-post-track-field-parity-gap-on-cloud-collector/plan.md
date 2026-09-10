# Track AM-10085: POST /track field-parity gap on the cloud collector

Filed as a Phase 6 follow-up from track AM-10083 (see that track's spec.md Finding F-3 and
Non-Goals).

Originally filed as AM-10084, but that number was independently assigned to a different track
("Meta-level config defaults cascading to projects") in main while this one only existed on the
track-10083 branch; the collision surfaced — and corrupted the pre-existing AM-10084's synced DB
fields — when track-10083 was merged. Renumbered to AM-10085 during that merge to resolve it; see
track-10083's merge for the live incident. The underlying track-numbering race is unresolved and
worth its own track.

**Planning note**: two of the six fields named in the original index.md summary
(`model_override`, `log_content`) turned out not to be plain "copy local's behavior" tasks once
both handlers were actually read — see spec.md's Planning Findings section for the full
reasoning. Scope below reflects that correction, not the original summary verbatim.

## Phase 0: Pre-flight — confirm no migration is needed

**Problem**: spec.md's requirement 4 (index.md's original Scope item 4) asks whether any of
these columns need a migration on the cloud database before the code change lands.
**Solution**: verify the columns already exist in the shared schema/migration history, and spot
check that the deployed cloud database actually has them (an ops check, not a new SQL file).

- [x] Confirm `prisma/schema.prisma` already declares `waiting_for_reply`, `auto_run`,
      `merge_mode`, `workspace_mode`, `model_override`, and all 12 KPI columns (already
      confirmed during planning — re-verify at implementation time in case of drift).
      **Correction found at implementation time**: `waiting_for_reply`, `auto_run`,
      `model_override`, and all 12 KPI columns were indeed already declared. `merge_mode` and
      `workspace_mode` were NOT — planning's "plus the pre-existing merge_mode/workspace_mode
      migrations" note (this file's line 31, as originally written) was checking the wrong
      migration directory. See the correction below.
- [x] Confirm each has a corresponding file under `migrations/` (already confirmed during
      planning: `20260814154139_add_waiting_for_reply.sql`, `20260820095249_add_auto_run.sql`,
      `20260506151159_add_track_type_kpi_fields.sql`, `20260818153000_add_track_model_override.sql`,
      plus the `merge_mode`/`workspace_mode` migrations).
      **Correction found at implementation time**: `merge_mode` and `workspace_mode` only ever
      had migration files under `ui/server/migrations/` (`009_merge_mode.sql`,
      `010_workspace_mode.sql`) — a directory with a *local-only* runner
      (`runMigration()` in `ui/server/index.mjs`, replayed on every local API server startup).
      The cloud database is migrated exclusively via `scripts/migrate.sh` (`atlas migrate
      apply` over the top-level `migrations/` directory, per `atlas.hcl`'s `src` list:
      `prisma/schema.sql` + `cloud/schema.sql` + `prisma/rls.sql`). Grepping all three of
      those plus every file already in `migrations/` turned up zero hits for `merge_mode`/
      `workspace_mode` before this track. This is the exact same gap track 10053 already found
      and fixed once for the pre-spawn-block columns (see
      `migrations/20260903120000_add_prespawn_block_columns.sql`'s own header comment) — same
      root cause, different columns. Fixed by adding
      `migrations/20260910090000_add_track_merge_workspace_mode.sql` (mirrors 20260903120000's
      structure: `ADD COLUMN IF NOT EXISTS`, so it's a no-op on any database that already has
      the columns), declaring both fields in `prisma/schema.prisma` and `prisma/schema.sql`,
      and regenerating `migrations/atlas.sum` via `atlas migrate hash`. `pr_number`/`pr_url`/
      `pr_status` (also added by `009_merge_mode.sql`) were deliberately left out of the new
      migration — cloud's `POST /track` doesn't read or write them, and porting them is a
      separate, out-of-scope gap (noted in Related below).
- [x] Note in the implement-phase conversation.md comment whether the actual deployed cloud DB
      was checked (`atlas migrate status` against the cloud DB URL, if reachable from this
      session) or whether that check is deferred to whoever deploys this change — do not block
      the code change on DB reachability from this environment.
      **Not reachable from this sandbox** (no cloud DB credentials/network access here) —
      deferred to whoever deploys this change; see conversation.md.

**Impact**: this is a pure application-code change for `waiting_for_reply`, `auto_run`,
`model_override`, and the 12 KPI columns, but required one new Atlas migration
(`20260910090000_add_track_merge_workspace_mode.sql`) for `merge_mode`/`workspace_mode`, which
were genuinely never applied to the cloud schema before this track.

## Phase 1: `waiting_for_reply` + `auto_run` parity

**Problem**: cloud's `POST /track` never writes these two booleans.
**Solution**: mirror `ui/server/index.mjs:3297,3300,3375-3376` exactly.

- [x] Add `waiting_for_reply, auto_run` to the destructured request body in
      `cloud/functions/index.js`'s `POST /track` handler.
- [x] Add both to the INSERT column list and VALUES, using
      `COALESCE($n, false)` on insert (matching local's `COALESCE($27, false)` /
      `COALESCE($28, false)` — raw value passed as `field === undefined ? null : field`).
- [x] Add both to `ON CONFLICT DO UPDATE SET` as
      `waiting_for_reply = COALESCE($n, tracks.waiting_for_reply)` and
      `auto_run = COALESCE($n, tracks.auto_run)`.

**Impact**: a track's `**Waiting for reply**`/`**Auto Run**` markers, synced via the cloud
collector, are actually persisted and survive a sync that omits them.

## Phase 2: `merge_mode` + `workspace_mode` parity

**Problem**: cloud's `POST /track` never writes these.
**Solution**: mirror `ui/server/index.mjs:3304-3306,3377-3378` exactly (raw-nullable insert,
`COALESCE(EXCLUDED.col, tracks.col)` update).

- [x] Add `merge_mode, workspace_mode` to the destructured request body.
- [x] Add both to the INSERT column list/VALUES (`merge_mode ?? null`, `workspace_mode ?? null`).
- [x] Add both to `ON CONFLICT DO UPDATE SET` as
      `merge_mode = COALESCE(EXCLUDED.merge_mode, tracks.merge_mode)` and
      `workspace_mode = COALESCE(EXCLUDED.workspace_mode, tracks.workspace_mode)`.
- [x] Carry over the explanatory comments from `ui/server/index.mjs` (why raw-nullable, why
      COALESCE) rather than leaving the cloud copy uncommented.
- [x] (Not in original plan, required by Phase 0's correction above) Added
      `migrations/20260910090000_add_track_merge_workspace_mode.sql`, declared both columns in
      `prisma/schema.prisma` + `prisma/schema.sql`, regenerated `migrations/atlas.sum`.

**Impact**: `**Merge Mode**`/`**Workspace**` markers survive a cloud-collector sync.

## Phase 3: KPI column parity (12 columns)

**Problem**: cloud's `POST /track` never writes any KPI column.
**Solution**: mirror `ui/server/index.mjs:3099-3101,3290-3294,3342-3374` exactly, including the
one deliberate asymmetry (`kpi_check_after` is NOT coalesced).

- [x] Add `track_type, kpi_target, kpi_actual, kpi_metric, kpi_source, kpi_source_config,
      kpi_threshold, kpi_window, kpi_snapshot, kpi_measured_at, kpi_check_after,
      kpi_scheduled_at, kpi_maps_to` to the destructured request body.
- [x] Add all 13 to the INSERT column list/VALUES:
      `track_type ?? 'dev'`, `kpi_snapshot ? JSON.stringify(kpi_snapshot) : null`, the rest
      `field ?? null`.
- [x] Add all 13 to `ON CONFLICT DO UPDATE SET`:
      - `track_type = COALESCE(EXCLUDED.track_type, tracks.track_type, 'dev')`
      - every KPI field except `kpi_check_after`:
        `COALESCE(EXCLUDED.col, tracks.col)`
      - `kpi_check_after = EXCLUDED.kpi_check_after` (always overwrites — do not COALESCE this
        one; see spec.md REQ-3).

**Impact**: KPI tracking (`lc measure`/quality-gate KPI checks) works correctly for projects on
the cloud collector, matching local behavior field-for-field.

## Phase 4: `model_override` — deliberate divergence from local

**Problem**: the worker sends `model_override` on every `POST /track` call; cloud drops it;
local's own `POST /track` also drops it (it's set by a separate PATCH endpoint cloud doesn't
have) — see spec.md Planning Finding 2 for the full reasoning.
**Solution**: add persistence to cloud anyway, since it's currently the only path a remote-api
deployment has to ever set this field. Document the divergence at the call site.

- [x] Add `model_override` to the destructured request body.
- [x] Add to INSERT column list/VALUES (`model_override ?? null`).
- [x] Add to `ON CONFLICT DO UPDATE SET`:
      `model_override = COALESCE(EXCLUDED.model_override, tracks.model_override)`.
- [x] Add a code comment explaining this is deliberately NOT a copy of local's `POST /track`
      behavior (which has none for this field) — it exists because cloud has no equivalent of
      the `PATCH /api/projects/:id/tracks/:num/model-override` endpoint yet, referencing this
      track number and spec.md's Planning Finding 2.

**Impact**: a remote-api project can have its per-track model override actually take effect,
which was previously impossible by any means.

## Phase 5: Regression tests

**Problem**: every field above needs the same rigor AM-10083 applied to
`lane_action_status` — a real assertion against generated SQL/bound params, since no
real-Postgres harness exists for `cloud/functions/index.js`.
**Solution**: extend the mocked-`pg` harness.

- [x] Write/extend `cloud/functions/test/track-10085-post-track-field-parity.test.js` (or the
      existing 10083 file — see spec.md REQ-6) reusing `mockAuth`/`mockAuthAndExisting`/
      `basePayload` from the 10083 test if kept in a separate file (extract to a shared helper
      module only if truly needed — don't over-engineer a two-file share).
      Written as a new sibling file (15 tests, all passing). The `mockAuth`/`mockCheckProjectOk`/
      `mockAuthAndExisting`/`basePayload`/`sqlAt`/`paramsAt` helpers and the `jest.mock('pg', ...)`
      wiring are duplicated verbatim rather than extracted to a shared module — jest hoists
      `jest.mock()` factories above all other statements in a file and only lets them reference
      module-scope `mock`-prefixed identifiers declared in the SAME file, so every existing
      `cloud/functions/test/*.test.js` file already repeats this same boilerplate for the same
      reason; extracting it would fight the framework, not simplify anything.
- [x] Per field in Phases 1-4: assert insert-time value, update-time payload-wins, and
      update-time omitted-field-preserves-existing (except `kpi_check_after`: assert it always
      overwrites, including when the payload sends nothing new — mirror whatever "nothing new"
      means in the existing param-building code, i.e. `null` still overwrites since there's no
      COALESCE guarding it).
      Because the upsert is a single unconditional `INSERT ... ON CONFLICT DO UPDATE`
      statement (not separate insert/update code paths), "insert wins" and "update payload
      wins" produce identical bound params under the mocked-`pg` harness — the distinguishing
      assertion is the generated SQL text itself (raw/EXCLUDED on the VALUES side,
      `COALESCE(EXCLUDED.col, tracks.col)` — or, for `kpi_check_after`, a bare `EXCLUDED.col`
      with no `COALESCE` — on the SET side). All 15 tests assert both the bound param and, for
      the omit-preserves and `kpi_check_after`-always-overwrites cases, the SQL text.
- [x] Run `conductor/tests/cloud-route-parity.test.mjs` and confirm it still passes unmodified.
      12/13 pass, 1 pre-existing failure (TC-4, missing `/worker/file-manifest` and
      `/project/:id/dispatch/claimed-by-offline-workers` routes) confirmed present at baseline
      *before* this track's changes (verified by stashing this track's diff and re-running) —
      unrelated to POST /track, not touched by this track, left as-is per REQ-7.
- [x] Run the full existing `cloud/functions/test/` suite to confirm no regression in
      `track-10083-post-track-lane-action-status.test.js`'s existing cases.
      6/6 pass, unmodified. Full suite: 101/102 pass; the one failure (`api.test.js`'s
      `GET /health` body-shape assertion) predates this track by a week (introduced 2026-09-04,
      track 1067, when `/health` grew `routes`/`api_version`/`server` fields the test was never
      updated for) and is nowhere near the `POST /track` handler this track touches.

**Impact**: this fix has the same regression coverage AM-10083 set as the bar for this failure
family — real SQL/param assertions, not a smoke test.

## ✅ COMPLETE

All 5 phases done. `cloud/functions/index.js`'s `POST /track` handler now destructures and
persists `waiting_for_reply`, `auto_run`, `merge_mode`, `workspace_mode`, `model_override`, and
all 12 KPI columns, with per-field semantics matching `ui/server/index.mjs` exactly (including
the `kpi_check_after` no-COALESCE asymmetry and the `model_override` deliberate divergence).
`merge_mode`/`workspace_mode` additionally required a new Atlas migration
(`migrations/20260910090000_add_track_merge_workspace_mode.sql`) plus `prisma/schema.prisma` /
`prisma/schema.sql` declarations and a regenerated `migrations/atlas.sum` — see Phase 0's
correction above. 15 new regression tests in
`cloud/functions/test/track-10085-post-track-field-parity.test.js`, all passing; no regressions
in the existing 10083 suite or `cloud-route-parity.test.mjs` (one pre-existing unrelated
failure each, confirmed present at baseline before this track).
