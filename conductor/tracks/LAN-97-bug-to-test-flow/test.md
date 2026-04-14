# Tests: Track 1045 — Bug-to-Test Flow

## Test Commands
```bash
# Run unit tests
cd ui && npx vitest run server/tests/bug-to-test.test.mjs

# Run all server tests
cd ui && npx vitest run server/tests/

# Manual: call open-bug endpoint
curl -s -X POST http://localhost:8091/api/projects/1/tracks/1045/open-bug \
  -H "Content-Type: application/json" \
  -d '{"description":"clicking open bug with no draft crashes the UI"}' | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('ok:', d.ok, 'test_appended:', d.test_appended)"

# Verify test.md on disk was updated
grep -c "TC-BUG-" conductor/tracks/1045-bug-to-test-flow/test.md

# Verify DB has updated test_content
psql $DATABASE_URL -c "SELECT track_number, length(test_content) FROM tracks WHERE track_number='1045'"
```

## Test Cases

### Phase 1: Backend endpoint
- [ ] TC-1: `POST /open-bug` with description → 201, `ok: true`, `test_appended: true`
- [ ] TC-2: `POST /open-bug` with empty/missing description → 201, uses placeholder text
- [ ] TC-3: `POST /open-bug` on non-existent track → 404
- [ ] TC-4: After `/open-bug`, `test.md` on disk contains new `TC-BUG-N` line
- [ ] TC-5: After `/open-bug`, DB `test_content` contains the same regression block
- [ ] TC-6: After `/open-bug`, comment `🐛 Bug reported:` appears in `track_comments`
- [ ] TC-7: After `/open-bug`, lane is `plan` in DB

### Phase 2: appendRegressionTest helper (unit tests)
- [ ] TC-8: Empty string input → output contains `## Test Cases` section + `TC-BUG-1` line
- [ ] TC-9: Input with zero existing `TC-BUG-` entries → appends `TC-BUG-1`
- [ ] TC-10: Input with 2 `TC-BUG-` entries → appends `TC-BUG-3`
- [ ] TC-11: Description with markdown special chars (`*`, `_`) does not break output format

### Phase 3: Frontend behaviour
- [ ] TC-12: Clicking "Open Bug" with draft text → network request to `/open-bug` with description
- [ ] TC-13: Clicking "Open Bug" clears the draft after success
- [ ] TC-14: "Open Feature" and "Brainstorm" buttons still work (no regression)
- [ ] TC-15: "Open Bug" button is disabled while the request is in flight

### Regression: This track (dogfooding)
- [ ] TC-BUG-1: Verify that clicking "Open Bug" without any draft does not crash the UI — expected: placeholder description used, 201 response

## Acceptance Criteria
- [ ] All 15 test cases pass
- [ ] No existing server tests fail
- [ ] test.md + test_content in DB are updated atomically (either both or neither)
