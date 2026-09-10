# Tests: Track 1081 — `**Summary**` marker gets silently overwritten with wrong content

## Test Commands

```bash
# New regression test for this track
node --test conductor/tests/track-1081-summary-truncation.test.mjs

# Regression: existing tests that touch the same code paths
node --test conductor/tests/track-10035-new-track-flags.test.mjs
node --test conductor/tests/sync-concurrent-edit-grace-period.test.mjs

# Syntax check on modified/new files
node --check conductor/summary-utils.mjs
node --check conductor/laneconductor.sync.mjs
```

## Test Cases

### Phase 1 — Mechanism 1 (verification only, no new test)
- [x] TC-1: `git log -S "Answered user question" -- conductor/laneconductor.sync.mjs` shows the
      fix landed in AM-10046 Phase 2 (`68752c17`) — expected: commit found, current file has no
      remaining occurrence of the hardcoded string.

### Phase 3 — Mechanism 2 fix
- [x] TC-2: `parseSummaryMarker(content)` with a `**Summary**` value of 500 `'x'` characters —
      expected: returns all 500 characters unchanged, no `truncateSummary`/"…" applied.
- [x] TC-3: `parseSummaryMarker(content)` with a short (<200 char) Summary — expected: unchanged
      behavior, returns the trimmed value.
- [x] TC-4: `parseSummaryMarker(content)` with an empty `**Summary**:` marker — expected: `null`
      (unchanged fallback-trigger behavior).
- [x] TC-5: `parseSummaryMarker(content)` with no `**Summary**` marker at all — expected: `null`.
- [x] TC-6: `parseSummary(content)` with no `**Summary**` marker but a long (>200 char)
      `**Problem**:` block — expected: the full derived text, unchanged, no truncation.
- [x] TC-7: `parseSummary(content)` with a `**Summary**` marker present — expected: prefers the
      marker over the `**Problem**` fallback (unchanged existing precedence).
- [x] TC-8: `truncateSummary(text, 200)` still exported and still truncates with a word-boundary
      cut + "…" when called directly — regression check that this helper's own behavior
      (still used by `parseCurrentPhaseMarker` for `**Phase**`) is unchanged, only its Summary
      call sites were removed.

## Acceptance Criteria
- [x] All new tests (TC-2 through TC-8) pass — 8/8.
- [x] Existing regression suites: `sync-concurrent-edit-grace-period` 4/4 pass.
      `track-10035-new-track-flags` 6/7 pass; the 1 failure is pre-existing (confirmed via
      `git stash` to fail identically on unmodified code — stale against a later, already-shipped
      default-flags change, unrelated to this track). Not fixed here — out of scope.
- [x] No regressions in `**Phase**` marker truncation behavior (still bounded to 200 chars via
      `truncateSummary`, imported unchanged into `laneconductor.sync.mjs`).
