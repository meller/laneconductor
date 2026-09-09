# Track AM-10085: POST /track field-parity gap on the cloud collector

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Summary**: The cloud collector's POST /track insert column list omits `waiting_for_reply`, `auto_run`, `merge_mode`, `workspace_mode`, `log_content`, `model_override`, and every KPI column the local collector…

## Problem

Filed as a Phase 6 follow-up from track AM-10083 (spec.md's Finding F-3 and
Non-Goals). While fixing AM-10083's RC-2 (the cloud `POST /track` upsert
couldn't apply a pushed `lane_action_status` on update), the investigation
found the same collector is missing a much wider set of fields on both the
insert column list and the `ON CONFLICT DO UPDATE` clause, compared to the
local collector (`ui/server/index.mjs`'s own `POST /track` handler):

- `waiting_for_reply`
- `auto_run`
- `merge_mode`
- `workspace_mode`
- `log_content`
- `model_override`
- every KPI column (`kpi_target`, `kpi_actual`, `kpi_metric`, `kpi_source`,
  `kpi_source_config`, `kpi_threshold`, `kpi_window`, `kpi_snapshot`,
  `kpi_measured_at`, `kpi_check_after`, `kpi_scheduled_at`, `kpi_maps_to`)

A project synced to the cloud collector (remote-api mode, or local-api +
cloud fire-and-forget) silently loses all of these fields on that collector
— they are simply never written, with no error anywhere. This is the same
"the two collectors disagree about what a payload means" family as
AM-10083, just wider in scope: an omitted column rather than a
misinterpreted one.

## Scope

1. Bring the cloud collector's `POST /track` insert column list and
   `ON CONFLICT DO UPDATE` clause up to parity with `ui/server/index.mjs`'s
   own handler for every field named above.
2. For each field, decide (and document) the same three questions
   AM-10083 Phase 2 had to answer for `lane_action_status`: does the payload
   win on update, does anything reset it on a lane change, and what
   happens when the payload omits it.
3. Regression test per field, in the spirit of
   `conductor/tests/cloud-route-parity.test.mjs` and the Jest-mocked-`pg`
   harness added in `cloud/functions/test/track-10083-post-track-lane-action-status.test.js`
   (no existing harness runs `cloud/functions/index.js` against a real
   Postgres instance — see that test's own header comment for why the
   mocked-`pg` approach was chosen over inventing a database fixture).
4. This is a real schema/migration-adjacent change (KPI columns especially)
   — review whether any of these columns need a migration on the cloud
   database before the code change can land, distinct from a pure
   application-code fix.

## Related

[AM-10083](../AM-10083-lane-action-status-transitions-go-local-only-letting-the-remote-collector-see-a-running-track-as-still-queued/index.md) — same collector-parity failure family (F-3), narrower scope (`lane_action_status` only), fixed first.
