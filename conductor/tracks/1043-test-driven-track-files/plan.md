# Plan: Track 1043 — Test-Driven Track Files

## Phase 1: DB Migration + API

- [x] Add `test_content TEXT` column to `tracks` table via migration
- [x] Create migration file `migrations/20260308000000_add_test_content.sql`
- [x] Update `prisma/schema.prisma` and `prisma/schema.sql`
- [x] Update `GET /api/projects/:id/tracks/:num` to return `test_content`
- [x] Update `POST /track` sync endpoint to accept and persist `test_content`
- [x] Apply migration locally + to prod Supabase via Atlas

## Phase 2: Sync Worker

- [x] In `conductor/laneconductor.sync.mjs`: read `test.md` alongside `plan.md`, `spec.md`, `index.md`
- [x] Include `test_content` in sync payload to API
- [x] Add `test.md` to worktree artifact copy list
- [x] Add `test.md` to context prompt for AI agents

## Phase 3: SKILL.md Updates

- [x] Update `## Track File Templates` section — add `test.md` template
- [x] Update `/laneconductor plan` — scaffold `test.md` after `spec.md` is written
- [x] Update `/laneconductor implement` — read `test.md`; write/run tests per phase; verify before marking phase complete
- [x] Update `/laneconductor review` — include test pass/fail in verdict; FAIL if tests don't pass
- [x] Update `/laneconductor quality-gate` — run test commands from `test.md` as primary automated check

## Phase 4: UI — Tests Tab in TrackDetailPanel

- [x] Add "Tests" tab to `CONTENT_TABS` in `TrackDetailPanel.jsx`
- [x] Fetch and render `test` field from the track API response (uses `detail?.[tab]` generic renderer)
- [x] Show placeholder when `test.md` doesn't exist yet
- [x] API returns `test: t.test_content` in `GET /api/projects/:id/tracks/:num`

## Phase 5: Test this Track's Implementation

- [x] Write `conductor/tracks/1043-test-driven-track-files/test.md` for this track itself (dogfooding)
- [x] Verify sync worker picks up `test.md` and updates DB (confirmed via API)
- [x] Verify Tests tab renders in UI (data flows: file → DB → API → UI)

## ✅ COMPLETE
