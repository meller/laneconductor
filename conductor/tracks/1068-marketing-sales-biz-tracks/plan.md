# Track 1068: Marketing & Sales (Biz Dev) Track Support

## Phase 0: Schema Migration (Prisma + Atlas)

**Problem**: DB has no KPI or track type fields. Must be added before anything else can be built.
**Solution**: Add fields to Prisma schema, regenerate schema.sql, run Atlas migration.

- [ ] Add 12 new fields to `tracks` model in `prisma/schema.prisma` (see spec.md Data Model Changes)
- [ ] Regenerate `prisma/schema.sql` via `prisma migrate diff`
- [ ] Run `atlas migrate diff --env local --name "add_track_type_kpi_fields"` to create migration file
- [ ] Run `atlas migrate apply --env local` to apply to local DB
- [ ] Verify migration with `atlas migrate status --env local`
- [ ] Update `generated/prisma` client: `npx prisma generate`
- [ ] Confirm all existing tracks default to `track_type = 'dev'`, all KPI fields NULL

**Impact**: DB schema is ready. No application behavior changes yet.

---

## Phase 1: Track Type Field + KPI Schema

**Problem**: No type field exists; all tracks are implicitly "dev". No KPI block in templates.
**Solution**: Add `**Type**` marker to index.md template, KPI section to spec.md template, and sync worker parsing for both.

- [ ] Add `**Type**: dev` to `index.md` template in skill (SKILL.md)
- [ ] Add `## KPI` section to `spec.md` template for non-dev types
- [ ] Update sync worker (`laneconductor.sync.mjs`) to parse `**Type**` marker and include in DB upsert
- [ ] Update `lc new` CLI to accept `--type [dev|marketing|sales|support|other]` flag
- [ ] Update `newTrack` skill command to write `**Type**` from argument or prompt

**Impact**: Every track has a type. Existing tracks default to `dev` — no migration needed.

---

## Phase 2: Planning Skill — KPI Block + Draft Section

**Problem**: Marketing/sales tracks can be planned without defining success or creating actionable content.
**Solution**: Planning skill enforces `## KPI` block for marketing/sales, and writes `## Draft` section to spec.md.

- [ ] In `/laneconductor plan`, after scaffold: if `type` is `marketing` or `sales`, check spec.md for `## KPI` block
- [ ] If missing: print `⚠️ KPI block required for marketing/sales tracks` and write stub KPI section to spec.md with TODOs
- [ ] Block `on_success` transition until KPI block has all required fields filled (non-empty Target, Metric, Source, Threshold)
- [ ] After planning is complete for non-dev tracks: write `## Draft` section to spec.md with publish-ready content and step-by-step `### Publish Instructions`
- [ ] No `draft.md` file — draft lives in spec.md alongside KPI and Requirements sections
- [ ] Moving to implement lane (drag or Run) IS the approval — no waiting state in plan, no `requires_approval` flag
- [ ] Add KPI validation function: `validateKpiBlock(specContent, trackType) → { valid: boolean, missing: string[] }`

**Impact**: No marketing/sales track can enter implement without a measurable success criterion AND publish-ready content.

---

## Phase 3: measure.mjs — Autoresearch Measurement Module

**Problem**: No automated way to query external signals against a KPI definition.
**Solution**: Lightweight Node.js module using native `fetch` (Node 18+), zero external dependencies.

- [ ] Create `conductor/measure.mjs` with `measureKpi(kpiSpec)` export
- [ ] Implement `hn-api` source: GET `https://hacker-news.firebaseio.com/v0/item/{item_id}.json`, read `score`
- [ ] Implement `reddit-api` source: GET `{post_url}.json`, read `data.children[0].data.ups`
- [ ] Implement `manual` source: reads `**KPI Actual**` marker from index.md (human-entered)
- [ ] Implement `custom-url` source: GET URL from Source Config, parse first numeric field in JSON response
- [ ] Return schema: `{ actual: number, target: number, threshold: number, passed: boolean, raw: object, measured_at: ISO }`
- [ ] Handle errors gracefully: network failure → `{ error: "...", passed: false }`
- [ ] Add `lc measure <track-number>` CLI command (runs measure.mjs for the track, prints result)

**Impact**: Any track with a KPI block can be measured on demand or by the quality gate.

---

## Phase 4: Supervised Implement + Quality Gate Scheduling

**Problem**: Implement has no model for non-dev tracks, and quality gate runs immediately after implement — but KPIs like "HN score after 48h" can't be measured until the window expires.
**Solution**: Supervised implement (human executes, replies "done") + worker-scheduled quality gate trigger.

### Supervised Implement
- [ ] In `/laneconductor implement`: detect non-dev track type
- [ ] Read `## Draft` from spec.md; output final publish-ready content + step-by-step instructions
- [ ] Set `**Waiting for reply**: yes` in index.md
- [ ] Worker watches for "done" reply in conversation.md, then transitions to quality-gate lane

### Quality Gate Scheduling
- [ ] On implement→quality-gate transition: read `**Window**` from spec.md KPI block (e.g. "48h", "7d")
- [ ] Compute `kpi_check_after = now + window`, write to index.md as `**KPI Check After**: <ISO>`
- [ ] Write `**KPI Scheduled At**: <ISO>` to index.md
- [ ] Worker polls `kpi_check_after`; auto-triggers quality gate when time is reached
- [ ] In `/laneconductor quality-gate NNN`: check `kpi_check_after`; if not yet reached, warn:
  > "KPI window not reached — Xh remaining. Measuring now may give unreliable results. Run anyway? (y/n)"
- [ ] Same early-trigger warning applies when human drags card to quality-gate in UI

### Quality Gate KPI Evaluation
- [ ] In `/laneconductor quality-gate`: read `**Type**` from index.md
- [ ] If type is non-dev OR spec.md has `## KPI` block: run `measure.mjs` before code checks
- [ ] Write result back to index.md: `**KPI Actual**: N` and `**KPI Snapshot**: <JSON>`
- [ ] If `passed: true`: continue to standard quality checks (or skip for non-dev), transition to `on_success`
- [ ] If `passed: false`: skip remaining checks, transition to `on_failure` (plan:queue per workflow.json)
- [ ] Log measurement result to `conversation.md`

**Impact**: Implement is human-supervised; quality gate waits for the measurement window before auto-triggering.

---

## Phase 5: Closed-Loop Replan with Measurement Data

**Problem**: When a KPI fails and the track goes back to planning, the planner has no context about what happened.
**Solution**: Write a structured `## ❌ KPI MISS` section to plan.md that the planning skill reads on reentry.

- [ ] On quality-gate KPI fail: append `## ❌ KPI MISS` to plan.md with: target, actual, delta, raw snapshot JSON, timestamp, window
- [ ] In `/laneconductor plan`: check if plan.md contains `## ❌ KPI MISS` section
- [ ] If present: read the failure data and use it as planning context — generate a *different* hypothesis (new content angle, different channel, different CTA)
- [ ] Preserve the KPI MISS history (don't overwrite old misses, append new ones) so the planner can see the full experiment trail
- [ ] Update spec.md `## KPI` block with any refined targets from the replan; update `## Draft` with new content
- [ ] Print to user: `♻️ Replanning with KPI data: target=100, actual=43, delta=-57`

**Impact**: Failed experiments feed the next iteration. No blind retries.

---

## Phase 6: Skill Recommendations + Missing-Skill Warnings

**Problem**: Users don't know which skills to invoke for marketing/sales tracks; missing skills cause silent failures.
**Solution**: Type-to-skill mapping checked at track creation and implement entry.

- [ ] Define skill map in skill: `{ marketing: ['social-content','copywriting','content-strategy','launch-strategy'], sales: ['sales-enablement','cold-email'] }`
- [ ] In `newTrack` command: after creating index.md, check `.claude/skills/` for each mapped skill
- [ ] Print per missing skill: `⚠️ Track type 'marketing' works best with [skill-name] — not found in .claude/skills/`
- [ ] In `/laneconductor implement`: repeat check at implement entry; if skills present, recommend: `💡 Invoke /[skill-name] before writing content`
- [ ] Add `lc check-skills <track-number>` CLI convenience command
- [ ] Document skill install path in warning message (symlink from laneconductor skills dir)

**Impact**: Users know which skills are available and are prompted to use them. Missing skills are surfaced before they matter, not after.

---

## Phase 7: UI — Type Badge + KPI Progress + Publish Required State

**Problem**: Kanban cards are type-blind and KPI-blind. Non-dev tracks waiting for human action show no context.
**Solution**: Add type badge, KPI progress bar, and "Publish Required" state to card components.

- [ ] Update Express API (`/api/projects/:id/tracks`) to return `track_type`, `kpi_target`, `kpi_actual`, `kpi_check_after` fields
- [ ] Add type badge component: coloured pill — DEV (grey), MKTG (blue), SALES (green), SUPPORT (amber), OTHER (grey)
- [ ] Add KPI progress bar to card: only renders if `kpi_target > 0`; shows `KPI: actual/target (%)` with filled bar
- [ ] Apply to both grid card and strip card layouts
- [ ] **Publish Required state**: implement cards with `waiting_for_reply: true` and non-dev type show "Publish Required" indicator
- [ ] Add "Mark as Published" button on Publish Required cards that writes "done" to conversation.md via API
- [ ] Add type filter to Kanban header (show all | dev | marketing | sales | support)
- [ ] Test: create a marketing track with KPI, verify badge, bar, and Publish Required state render correctly

**Impact**: At a glance, the board shows track type, KPI progress, and whether human action is needed.

---

## Phase 8: Scaffold + Setup Wizard Integration

**Problem**: KPIs are a first-class concept but absent from project onboarding — new projects have no `kpis.md` and the setup wizard never asks about success metrics.
**Solution**: Add `kpis.md` to the scaffold template and one KPI question to the setup brainstorm loop.

- [ ] Add `kpis.md` to the file list in `setup scaffold generate` section of SKILL.md
- [ ] In scaffold generation: populate `kpis.md` from brainstorm summary — extract any goal/metric statements the user made
- [ ] If brainstorm has no metric content: generate a stub table with placeholder rows and a comment to fill in
- [ ] Add one new question to the setup wizard brainstorm loop (after product description, before tech stack):
  > "What does success look like? What are your 2–3 north-star metrics and rough targets? (e.g. '500 signups by Q2', '1000 DAUs')"
- [ ] Add `**Maps To**` as an optional field in the per-track `## KPI` block template in SKILL.md
- [ ] Add `kpi_maps_to String?` column to Prisma schema (include in Phase 0 migration)
- [ ] Update sync worker to parse `**Maps To**` from spec.md KPI block and upsert `kpi_maps_to` column
- [ ] Update Phase 7 UI: add project-level KPI roll-up panel — groups per-track actuals by `kpi_maps_to`, shows aggregate progress against `kpis.md` targets
- [ ] Print scaffold progress line: `📝 Writing conductor/kpis.md...  ✅`
- [ ] Verify: `lc setup` on a fresh project creates `conductor/kpis.md` with content

**Impact**: Every new project starts with defined success metrics. Marketing/sales tracks can reference project goals from day one.

---

## Phase 9: KPI Window Countdown on Quality-Gate Cards

**Problem**: Quality-gate cards with a KPI window give no indication of when measurement can run — users can't tell if a track is waiting on time or just stuck.
**Solution**: Show a live countdown on quality-gate cards when `kpi_check_after` is in the future; show "ready to measure" when the window has closed.

- [x] Add `KpiWindowCountdown` component to `TrackCard.jsx`
- [x] Renders only on `lane_status === 'quality-gate'` cards
- [x] Window still open: purple pill — "KPI window closes in Xd Yh" or "Xh Ym"
- [x] Window closed: green pill — "KPI window closed — ready to measure"
- [x] Updates every 60s via `setInterval`
- [x] Gracefully skips if `kpi_check_after` is null (non-KPI quality-gate tracks unaffected)

**Impact**: At a glance, the board shows exactly which quality-gate tracks are waiting on time vs ready to run.

---

## ✅ Completion Criteria

All 7 phases done, all test cases in test.md passing, and a real marketing track (e.g. 1052-show-hn-post) successfully runs through the full loop: plan with KPI + Draft → implement (supervised) → human publishes → quality-gate schedules via kpi_check_after → auto-triggers → pass/fail transitions correctly.
