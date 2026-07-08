# Tests: Track 1068 — Marketing & Sales (Biz Dev) Track Support

## Test Commands

```bash
# Run all track 1068 tests
node conductor/tests/track-1068-biz-tracks.test.mjs

# Run measure.mjs directly against a live HN post
node conductor/measure.mjs --track 1052 --dry-run

# Check skill availability for a marketing track
node bin/lc.mjs check-skills 1068
```

## Test Cases

### Phase 1: Track Type Field

- [ ] TC-1: Create track with `--type marketing` — index.md contains `**Type**: marketing`
- [ ] TC-2: Create track without `--type` — index.md contains `**Type**: dev` (default)
- [ ] TC-3: Sync worker parses `**Type**: sales` from index.md and includes it in DB upsert payload
- [ ] TC-4: Existing track with no `**Type**` marker syncs as `dev` — no error, no data loss
- [ ] TC-5: `lc new "My Campaign" "desc" --type marketing` creates track with correct type

### Phase 2: KPI Block Enforcement + Draft Section

- [ ] TC-6: Plan a `marketing` track without `## KPI` in spec.md — plan command prints warning and writes KPI stub
- [ ] TC-7: Plan a `marketing` track with incomplete KPI (missing Threshold) — plan blocks transition, lists missing fields
- [ ] TC-8: Plan a `marketing` track with complete KPI block — transitions to `plan:success` normally
- [ ] TC-9: Plan a `dev` track without KPI — no warning, transitions normally
- [ ] TC-10: Plan a `sales` track without KPI — same enforcement as marketing
- [ ] TC-11: After successful plan of marketing track, spec.md contains `## Draft` section with content
- [ ] TC-12: After successful plan of marketing track, spec.md `## Draft` contains `### Publish Instructions` subsection
- [ ] TC-13: No `draft.md` file is created — all draft content lives in spec.md
- [ ] TC-14: Moving a `marketing` track from `plan:success` to implement requires no extra approval step — move IS the approval

### Phase 3: measure.mjs

- [ ] TC-15: `measureKpi({ source: 'hn-api', sourceConfig: 'item_id=1', threshold: 1 })` returns `{ actual: number, passed: boolean }`
- [ ] TC-16: HN item with score > threshold → `passed: true`
- [ ] TC-17: HN item with score < threshold → `passed: false`
- [ ] TC-18: `manual` source with `**KPI Actual**: 43` in index.md → returns `actual: 43`
- [ ] TC-19: `custom-url` source with a mock JSON endpoint → parses first numeric field correctly
- [ ] TC-20: Network failure → returns `{ error: "...", passed: false }` without throwing
- [ ] TC-21: `reddit-api` source with a real post URL → returns `actual: number` (upvote count)
- [ ] TC-22: `lc measure 1068` CLI command runs and prints result table

### Phase 4: Supervised Implement + Quality Gate Scheduling

- [ ] TC-23: Implement on `marketing` track reads `## Draft` from spec.md and outputs it with instructions
- [ ] TC-24: After implement output, index.md has `**Waiting for reply**: yes`
- [ ] TC-25: Worker detects "done" reply in conversation.md and transitions track to quality-gate lane
- [ ] TC-26: Worker does NOT auto-trigger quality gate on a track that has not reached `kpi_check_after`
- [ ] TC-27: After human reply "done", worker writes `**KPI Check After**` and `**KPI Scheduled At**` to index.md
- [ ] TC-28: `kpi_check_after` = `kpi_scheduled_at` + parsed window (e.g. "48h" → +48 hours)
- [ ] TC-29: Worker auto-triggers quality gate when system clock passes `kpi_check_after`
- [ ] TC-30: Manual `/laneconductor quality-gate NNN` before `kpi_check_after` — skill prints warning with hours remaining
- [ ] TC-31: Warning text: "KPI window not reached — Xh remaining. Measuring now may give unreliable results. Run anyway? (y/n)"
- [ ] TC-32: User answers "y" to early trigger warning — quality gate runs anyway
- [ ] TC-33: User answers "n" to early trigger warning — quality gate does NOT run
- [ ] TC-34: Quality gate on `marketing` track with KPI — runs measure.mjs before code checks
- [ ] TC-35: KPI pass → writes `**KPI Actual**` to index.md, continues to standard checks (or skips for non-dev)
- [ ] TC-36: KPI fail → writes `**KPI Actual**` and `**KPI Snapshot**` to index.md, transitions to `plan:queue`, skips code checks
- [ ] TC-37: Quality gate on `dev` track without KPI block — does NOT run measure.mjs
- [ ] TC-38: Quality gate on `dev` track WITH optional KPI block — runs measure.mjs
- [ ] TC-39: KPI fail appends result to `conversation.md` with structured message

### Phase 5: Closed-Loop Replan

- [ ] TC-40: Quality gate KPI fail writes `## ❌ KPI MISS` to plan.md with target, actual, delta, timestamp
- [ ] TC-41: Second KPI fail appends a new `## ❌ KPI MISS` entry without overwriting the first
- [ ] TC-42: Plan command on track with `## ❌ KPI MISS` reads it and generates different approach (different content angle or channel)
- [ ] TC-43: Replan prints `♻️ Replanning with KPI data: target=X, actual=Y, delta=Z`
- [ ] TC-44: Updated spec.md after replan reflects new hypothesis in `## Draft`, preserves KPI history
- [ ] TC-45: Replan updates `## Draft` section in spec.md with new content — does NOT create a new file

### Phase 6: Skill Recommendations

- [ ] TC-46: Create marketing track when `social-content` skill is absent → warning printed
- [ ] TC-47: Create marketing track when `social-content` skill is present → confirmation printed
- [ ] TC-48: Enter implement on sales track missing `cold-email` skill → warning + recommendation printed
- [ ] TC-49: `lc check-skills 1068` prints full skill availability table for the track's type
- [ ] TC-50: Warning includes install path hint

### Phase 7: UI

- [ ] TC-51: GET `/api/projects/:id/tracks` returns `track_type`, `kpi_target`, `kpi_actual`, `kpi_check_after` for each track
- [ ] TC-52: Kanban grid card renders type badge for a `marketing` track
- [ ] TC-53: KPI progress bar renders only when `kpi_target > 0`
- [ ] TC-54: KPI progress bar shows correct percentage (actual/target)
- [ ] TC-55: Type filter in Kanban header filters to show only marketing tracks
- [ ] TC-56: Strip card layout also shows type badge
- [ ] TC-57: Implement card with `waiting_for_reply: true` and non-dev type shows "Publish Required" indicator
- [ ] TC-58: "Mark as Published" button on Publish Required card writes "done" to conversation.md via API
- [ ] TC-59: After "Mark as Published" click, card clears "Publish Required" state (Waiting for reply becomes no)
- [ ] TC-60: Dev track with `waiting_for_reply: true` does NOT show "Publish Required" state (dev tracks wait for other reasons)

## Acceptance Criteria

- [ ] Full loop test: track 1052 (Show HN post) runs plan → implement (supervised, Waiting for reply) → human replies done → quality-gate schedules via kpi_check_after → auto-triggers → HN API measurement → correct pass/fail transition
- [ ] All 60 test cases pass
- [ ] No regressions in existing dev track workflow (type defaults to dev, no KPI enforcement for dev, no Publish Required state for dev waiting cards)
- [ ] DB migration is backward compatible (existing tracks get `track_type = 'dev'`, all KPI columns NULL)
