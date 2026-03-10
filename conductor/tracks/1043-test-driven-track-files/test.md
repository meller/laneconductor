# Tests: Track 1043 — Test-Driven Track Files

## Test Commands
```bash
# Verify test_content column exists in DB
psql $DATABASE_URL -c "\d tracks" | grep test_content

# Verify API returns test_content field
curl -s http://localhost:8091/api/projects/1/tracks/1043 | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('test field present:', 'test' in d)"

# Verify sync worker includes test_content in payload (grep source)
grep -n "test_content" conductor/laneconductor.sync.mjs

# Verify Tests tab appears in UI (check component source)
grep -n "test" ui/src/components/TrackDetailPanel.jsx | grep -i "Tests\|test_content\|detail\.test"
```

## Test Cases

### Phase 1: DB Migration + API
- [x] TC-1: `test_content` column exists on `tracks` table in local DB
- [x] TC-2: `GET /api/projects/:id/tracks/:num` response includes `test` field
- [x] TC-3: `POST /track` with `test_content` payload persists value to DB and returns it on next GET
- [x] TC-4: `POST /track` without `test_content` does not break existing upsert (backwards compat)

### Phase 2: Sync Worker
- [x] TC-5: `syncTrack()` reads `test.md` from track folder and includes `test_content` in API payload
- [x] TC-6: Creating/modifying `test.md` triggers a sync cycle and updates DB `test_content`
- [x] TC-7: Worktree artifact copy includes `test.md` in the copied file list
- [x] TC-8: Context prompt for AI agents includes `test.md` content

### Phase 3: SKILL.md
- [x] TC-9: `test.md` template is present in the Track File Templates section
- [x] TC-10: `/laneconductor plan` instructions mention scaffolding `test.md`
- [x] TC-11: `/laneconductor implement` instructions mention reading `test.md`
- [x] TC-12: `/laneconductor review` instructions mention running tests from `test.md`
- [x] TC-13: `/laneconductor quality-gate` instructions mention `test.md` as primary check

### Phase 4: UI Tests Tab
- [x] TC-14: "Tests" tab appears in TrackDetailPanel alongside Plan/Spec/Overview
- [x] TC-15: Tests tab renders `test_content` as Markdown when present
- [x] TC-16: Tests tab shows placeholder message when `test.md` is absent (no content crash)

### Phase 5: Dogfooding
- [x] TC-17: This `test.md` file is synced by worker and `test_content` is populated in DB
- [x] TC-18: Tests tab in UI renders this file's content for track 1043

## Acceptance Criteria
- [x] All 18 test cases pass
- [x] No regressions in existing plan/spec/index tab rendering
- [x] Backwards-compatible: existing tracks without test.md render all tabs correctly
 
  
