# Tests: Track AM-10085 — POST /track field-parity gap on the cloud collector

## Test Commands

```bash
# Cloud functions test suite (Jest, mocked pg — see track-10083's test file header
# comment for why there's no real-Postgres harness for cloud/functions/index.js)
cd cloud/functions && npx jest test/track-10085-post-track-field-parity.test.js
cd cloud/functions && npx jest test/track-10083-post-track-lane-action-status.test.js
cd cloud/functions && npx jest

# Route-parity sanity check (this track only adds fields to an already-served route —
# should be unaffected, but confirm)
node --test conductor/tests/cloud-route-parity.test.mjs
```

## Test Cases

**Implementation note**: the upsert is a single unconditional `INSERT ... ON CONFLICT DO
UPDATE` statement, not separate insert/update code paths, so under the mocked-`pg` harness
"insert binds X" and "update payload wins with X" produce the identical bound-param assertion —
each TC pair below (e.g. TC-1.1/1.2) is covered by one test asserting the bound param, plus a
second test asserting the omit-preserves SQL text (or, for `kpi_check_after`, the
no-COALESCE overwrite text). See `cloud/functions/test/track-10085-post-track-field-parity.test.js`.

### Phase 1: `waiting_for_reply` / `auto_run`
- [x] TC-1.1: `POST /track` with `waiting_for_reply: true` on a brand-new track — assert the
      INSERT VALUES bind `true` (via `COALESCE($n, false)`).
- [x] TC-1.2: `POST /track` with `waiting_for_reply: true` on an existing track whose DB row
      has `false` — assert the UPDATE sets it to `true`.
- [x] TC-1.3: `POST /track` with `waiting_for_reply` omitted (undefined) on an existing track
      whose DB row has `true` — assert the UPDATE clause's bound param is `null` and the SQL
      text uses `COALESCE($n, tracks.waiting_for_reply)`, i.e. the existing `true` is not
      clobbered.
- [x] TC-1.4 / TC-1.5 / TC-1.6: same three cases (insert, update-wins, omit-preserves) for
      `auto_run`.

### Phase 2: `merge_mode` / `workspace_mode`
- [x] TC-2.1: `POST /track` with `merge_mode: 'direct'` on insert — assert bound param is
      `'direct'`.
- [x] TC-2.2: `POST /track` with `merge_mode: 'pr'` on an existing row currently `'direct'` —
      assert UPDATE sets it to `'pr'`.
- [x] TC-2.3: `POST /track` with `merge_mode` omitted on an existing row — assert
      `COALESCE(EXCLUDED.merge_mode, tracks.merge_mode)` keeps the existing value (bound param
      `null`).
- [x] TC-2.4 / TC-2.5 / TC-2.6: same three cases for `workspace_mode` (`'branch'`/`'main'`).

### Phase 3: KPI columns
- [x] TC-3.1: `POST /track` with a full `## KPI`-derived payload
      (`track_type: 'marketing'`, `kpi_target: 100`, `kpi_metric: 'HN score'`,
      `kpi_source: 'hn-api'`, `kpi_source_config: 'item=123'`, `kpi_threshold: 50`,
      `kpi_window: '48h'`, `kpi_snapshot: {raw: 1}`, `kpi_maps_to: 'signups'`) on insert —
      assert every field is bound, and `kpi_snapshot` is bound as the `JSON.stringify`-ed
      string, not the raw object.
- [x] TC-3.2: `POST /track` with `track_type` omitted — assert insert defaults to `'dev'`
      (`track_type ?? 'dev'` in the VALUES list) and update falls back to
      `COALESCE(EXCLUDED.track_type, tracks.track_type, 'dev')`.
- [x] TC-3.3: `POST /track` with `kpi_actual: 42` on an existing row whose `kpi_actual` is
      `null` — assert UPDATE sets `42`.
- [x] TC-3.4: `POST /track` with `kpi_actual` omitted on an existing row whose `kpi_actual` is
      `42` — assert `COALESCE(EXCLUDED.kpi_actual, tracks.kpi_actual)` preserves `42`.
- [x] TC-3.5 (the asymmetry): `POST /track` with `kpi_check_after` omitted on an existing row
      whose `kpi_check_after` is a non-null timestamp — assert the UPDATE clause uses
      `kpi_check_after = EXCLUDED.kpi_check_after` (no COALESCE) and the bound param is `null`,
      i.e. this field IS clobbered to `null` by an omitted payload, unlike every other KPI
      field. This is the one case where "payload omits it" does NOT mean "preserved" — assert
      it explicitly so a future refactor doesn't silently harmonize it into a COALESCE.
- [x] TC-3.6: repeat TC-3.1's insert case and TC-3.3/3.4's update-wins/omit-preserves pattern
      for the remaining KPI fields not individually covered above
      (`kpi_metric`, `kpi_source`, `kpi_source_config`, `kpi_threshold`, `kpi_window`,
      `kpi_measured_at`, `kpi_scheduled_at`, `kpi_maps_to`) — table-driven is fine, doesn't need
      one `it()` per field if a parameterized test covers the same assertions.
      Implemented as a 2-field parameterized loop (`kpi_measured_at`, `kpi_scheduled_at`) —
      `kpi_metric`/`kpi_source`/`kpi_source_config`/`kpi_threshold`/`kpi_window` are already
      exercised individually by TC-3.1's full-payload insert assertion above.

### Phase 4: `model_override`
- [x] TC-4.1: `POST /track` with `model_override: 'claude-opus-4-5'` on insert — assert bound
      param is `'claude-opus-4-5'`.
- [x] TC-4.2: `POST /track` with `model_override` set on an existing row currently `null` —
      assert UPDATE sets it.
- [x] TC-4.3: `POST /track` with `model_override` omitted on an existing row with a value —
      assert `COALESCE(EXCLUDED.model_override, tracks.model_override)` preserves it.

### Regression / parity sanity
- [x] TC-5.1: `conductor/tests/cloud-route-parity.test.mjs` passes unmodified.
      12/13 pass; the 1 failure (TC-4, missing `/worker/file-manifest` and
      `/project/:id/dispatch/claimed-by-offline-workers` routes) is confirmed pre-existing at
      baseline, unrelated to this track.
- [x] TC-5.2: every existing test in
      `cloud/functions/test/track-10083-post-track-lane-action-status.test.js` still passes.
      6/6 pass.
- [x] TC-5.3: the full `cloud/functions/test/` Jest suite passes with no new failures.
      101/102 pass; the 1 failure (`api.test.js`'s `GET /health` body-shape assertion) predates
      this track (2026-09-04, track 1067) and is unrelated to `POST /track`.

## Acceptance Criteria
- [x] All test cases above pass.
- [x] No column from spec.md's Requirements is missing from either the INSERT list or the
      `ON CONFLICT DO UPDATE` clause in `cloud/functions/index.js`'s `POST /track` handler.
- [x] `log_content` is confirmed NOT added (spec.md REQ-5) — no test case should exist for it;
      its absence is the correct, documented outcome for this track.
