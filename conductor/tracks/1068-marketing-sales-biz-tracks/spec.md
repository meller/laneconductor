# Spec: Track 1068 — Marketing & Sales (Biz Dev) Track Support

## Problem Statement

LaneConductor treats all tracks as dev work. A marketing campaign, a sales outreach, or a biz dev initiative has a fundamentally different success condition: not "did the code ship" but "did the action achieve its goal." Currently there is no way to define a goal, measure it, or loop back when it fails with actual data.

## Requirements

### REQ-1: Track Type Field
- Every track has a `**Type**` marker in `index.md`: `dev | marketing | sales | support | other`
- Defaults to `dev` if omitted (backward compatible)
- Propagated to the DB `tracks` table via the sync worker

### REQ-2: KPI Schema in spec.md
KPI block is mandatory for `marketing` and `sales` types, optional for others.

```markdown
## KPI
**Target**: <numeric goal, e.g. "100 signups", "500 upvotes", "10 replies">
**Metric**: <what to measure, e.g. "HN post score", "Reddit upvote count", "email reply rate">
**Source**: <where data lives: hn-api | reddit-api | ga4 | stripe | manual | custom-url>
**Source Config**: <API endpoint or query params, e.g. `item_id=12345` or `ga4_property=G-XXXXX`>
**Threshold**: <minimum value to pass quality gate, e.g. "50">
**Window**: <measurement window, e.g. "48h", "7d">
```

Planning skill must block transition to implement if type is marketing/sales and `## KPI` block is absent from spec.md.

### REQ-3: Plan Writes Draft to spec.md
For non-dev tracks, the planning skill writes a `## Draft` section to spec.md (alongside KPI, Problem, Requirements). The draft is the publish-ready content: post text, email copy, or other deliverable.

No separate `draft.md` file is created — file structure stays identical to dev tracks.

Moving the track to implement IS the approval. The human reads the draft in spec.md while the card sits at `plan:success`, then moves it to implement to proceed.

```markdown
## Draft
<full publish-ready content here — post text, email copy, etc.>

### Publish Instructions
1. <step-by-step instructions for the human to execute>
2. <e.g. "Go to news.ycombinator.com/submit, paste title and URL below">
3. <include exact copy-paste text where relevant>
```

### REQ-4: Supervised Implement for Non-Dev Tracks
For non-dev tracks, implement lane does NOT auto-post. It:
1. Reads `## Draft` from spec.md
2. Outputs final publish-ready content + step-by-step instructions
3. Sets `**Waiting for reply**: yes`
4. Human executes the action (posts, sends, etc.) manually
5. Human replies "done" in conversation.md
6. Worker resumes and transitions to quality-gate lane

### REQ-5: measure.mjs — Autoresearch Measurement Module
A lightweight Node.js module at `conductor/measure.mjs` (no external deps beyond built-in `fetch`). Given a track's KPI spec, it:
1. Identifies the source type from `**Source**`
2. Queries the appropriate endpoint
3. Returns `{ actual: number, target: number, passed: boolean, raw: object }`

**Supported sources (v1):**
| Source | Query method | What it reads |
|--------|-------------|---------------|
| `hn-api` | `https://hacker-news.firebaseio.com/v0/item/{id}.json` | `score`, `descendants` (comment count) |
| `reddit-api` | Reddit JSON API `{post_url}.json` | `ups`, `num_comments` |
| `ga4` | GA4 Data API (requires service account) | sessions, conversions |
| `manual` | Reads `**KPI Actual**` marker from index.md | Human-entered value |
| `custom-url` | GET request to `**Source Config**` URL | Parses JSON response for numeric field |

### REQ-6: Quality Gate KPI Evaluation
Quality gate for non-dev tracks (or any track with a KPI block) runs `measure.mjs` before checking code quality. Outcome:
- **PASS**: `actual >= threshold` → proceed to `on_success` lane
- **FAIL**: `actual < threshold` → attach measurement snapshot to index.md as `**KPI Actual**: N` and `**KPI Snapshot**: {...}`, then transition to `on_failure` lane (typically `plan:queue`)

### REQ-7: Scheduled Quality Gate + Early Trigger Override
After implement transitions to quality-gate (or sets `**Waiting for reply**: yes`), the worker schedules the measurement:
- Writes `**KPI Check After**: <ISO timestamp>` and `**KPI Scheduled At**: <ISO timestamp>` to index.md
- Worker auto-triggers quality gate when `kpi_check_after` time is reached
- If user manually invokes `/laneconductor quality-gate NNN` before `kpi_check_after`, skill warns:
  > "KPI window not reached — 31h remaining. Measuring now may give unreliable results. Run anyway? (y/n)"
- Same warning applies when human drags card to quality-gate in UI before scheduled time
- `kpi_check_after` can be overridden by the user at any time

### REQ-8: Closed-Loop Replan
When quality gate fails due to KPI miss:
- Write `## ❌ KPI MISS` section to plan.md with: target, actual, delta, raw snapshot, timestamp
- The planning skill reads this section when re-entered and uses it as context to generate a different hypothesis/approach
- Ensures replanning is data-driven, not blind retry

### REQ-9: Skill Recommendations by Track Type
When a track is created or enters the implement lane:
- Check `.claude/skills/` for skills relevant to the track type
- **Marketing**: check for `social-content`, `copywriting`, `content-strategy`, `launch-strategy`
- **Sales**: check for `sales-enablement`, `cold-email`
- If a recommended skill is missing: print `⚠️ Track type 'marketing' works best with [skill] — not found in .claude/skills/`
- If present: print `✅ [skill] available` and recommend invoking it in implement

### REQ-10: UI — Type Badge + KPI Progress + Publish Required State
Kanban cards show:
- Type badge (coloured pill): `DEV` (grey) | `MKTG` (blue) | `SALES` (green) | `SUPPORT` (yellow) | `OTHER` (grey)
- KPI progress bar (only if KPI defined): `KPI: 43/100 ▓▓▓░░░░░░░ 43%`
- Both visible in grid and strip card layouts
- **Publish Required state**: implement cards with `**Waiting for reply**: yes` show a "Publish Required" indicator in the UI with a "Mark as Published" button that writes "done" to conversation.md

## Acceptance Criteria

- [ ] `**Type**: marketing` in index.md syncs to DB via worker
- [ ] Planning skill blocks marketing/sales tracks without KPI block
- [ ] Planning skill writes `## Draft` section to spec.md for non-dev tracks
- [ ] Moving track to implement (drag or Run) serves as approval — no extra mechanism needed
- [ ] Implement reads `## Draft`, outputs instructions, sets `**Waiting for reply**: yes`
- [ ] `measure.mjs` queries HN API and returns correct pass/fail for a real post
- [ ] `measure.mjs` queries Reddit API and returns correct pass/fail
- [ ] Quality gate runs measure.mjs for tracks with KPI, skips for dev tracks without KPI
- [ ] Worker schedules quality gate via `kpi_check_after` after implement completes
- [ ] Early trigger warning fires when user invokes quality gate before `kpi_check_after`
- [ ] KPI fail writes `## ❌ KPI MISS` to plan.md with data snapshot
- [ ] Replan (plan command on failed track) reads KPI MISS section and reflects it in new spec
- [ ] Missing skill warning prints at track creation time for marketing/sales types
- [ ] Kanban card shows type badge
- [ ] Kanban card shows KPI progress bar when KPI is defined
- [ ] Implement cards waiting for reply show "Publish Required" state with "Mark as Published" button

## Data Model Changes

### Prisma (`prisma/schema.prisma`) — add to `tracks` model:
```prisma
track_type        String?   @default("dev")        // dev | marketing | sales | support | other
kpi_target        Int?                              // numeric goal, e.g. 100
kpi_actual        Int?                              // measured value — written by measure.mjs
kpi_metric        String?                           // human label, e.g. "HN post score"
kpi_source        String?                           // hn-api | reddit-api | ga4 | manual | custom-url
kpi_source_config String?                           // query params/URL, e.g. "item_id=12345"
kpi_threshold     Int?                              // minimum value to pass gate
kpi_window        String?                           // measurement window, e.g. "48h", "7d"
kpi_snapshot      Json?                             // raw API response from last measure run
kpi_measured_at   DateTime? @db.Timestamp(6)        // timestamp of last measurement
kpi_check_after   DateTime? @db.Timestamp(6)        // scheduled time for quality gate auto-trigger
kpi_scheduled_at  DateTime? @db.Timestamp(6)        // when the schedule was set (for display)
kpi_maps_to       String?                            // north-star metric name from conductor/kpis.md
```

After editing `schema.prisma`, regenerate `prisma/schema.sql`:
```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/schema.sql
```
Then run Atlas to generate and apply the migration:
```bash
atlas migrate diff --env local --name "add_track_type_kpi_fields"
atlas migrate apply --env local
```

### `index.md` — new markers (synced to/from DB by worker):
```
**Type**: marketing
**KPI Target**: 100
**KPI Actual**: 43           ← written by measure.mjs after quality gate runs
**KPI Snapshot**: {...}      ← JSON blob of raw API response (truncated for readability)
**KPI Check After**: 2026-05-08T12:00:00Z   ← scheduled measurement time
**KPI Scheduled At**: 2026-05-06T12:00:00Z  ← when schedule was set
```

### `spec.md` — new sections for non-dev types:
```markdown
## KPI
**Target**: 100
**Metric**: HN post score
**Source**: hn-api
**Source Config**: item_id=12345
**Threshold**: 50
**Window**: 48h

## Draft
<publish-ready content>

### Publish Instructions
1. Go to news.ycombinator.com/submit
2. Paste title: "..."
3. Paste URL: "..."
```

### Sync worker — new markers to parse:
The worker must parse `**Type**`, `**KPI Target**`, `**KPI Actual**`, `**KPI Snapshot**`, `**KPI Check After**`, and `**KPI Scheduled At**` from `index.md` and upsert the corresponding DB columns.

The `kpi_metric`, `kpi_source`, `kpi_source_config`, `kpi_threshold`, and `kpi_window` fields are read from `spec.md` (the `## KPI` block) — not from `index.md` — since they are planning-time config, not runtime state.

### REQ-11: kpis.md in Scaffold + Setup Wizard

**Scaffold**: `conductor/kpis.md` is generated alongside `product.md`, `tech-stack.md`, etc. during `lc setup scaffold generate`. Content is populated from brainstorm answers about project goals and north-star metrics.

**Setup wizard**: One new question added to the brainstorm loop (after product description, before tech stack):
> "What does success look like for this project? What are your 2-3 north-star metrics and rough targets? (e.g. '500 signups by end of Q2', '1000 DAUs', '$10k MRR')"

**kpis.md template**:
```markdown
# Project KPIs

## North-Star Metrics

| Metric | Target | Time Horizon | Notes |
|--------|--------|--------------|-------|
| <metric> | <target> | <e.g. Q2 2026> | <context> |

## Contributing Tracks

Tracks with `**Maps To**` referencing a metric above will appear here automatically.
(Updated by the worker as tracks complete quality gates.)
```

**Per-track link**: Per-track KPI block gains an optional `**Maps To**` field referencing a metric name from `kpis.md`:
```markdown
## KPI
**Target**: 100
**Metric**: HN post score
**Source**: hn-api
**Source Config**: item_id=12345
**Threshold**: 50
**Window**: 48h
**Maps To**: signups
```

The worker reads `**Maps To**` and stores it in a new `kpi_maps_to` DB column. The UI roll-up groups per-track actuals by this value against the project-level target in `kpis.md`.

**kpis.md** is an authored document — only the human edits it (strategy changes). The worker never writes to it. Per-track KPIs are measured and updated by the worker independently.

## Out of Scope (v1)

- GA4 integration (requires service account setup — stub with `manual` fallback)
- Stripe / CRM integrations
- Automated posting (implement lane posts content — that's a per-track concern, not this track)
- KPI history / trend tracking across multiple cycles
- `requires_approval` field — moving to implement IS the approval
