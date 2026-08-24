# Tests: Track 8003 — Concurrency A 1786523175558

## Test Commands
```bash
# Playwright E2E that created and drives this fixture track
npx playwright test conductor/tests/playwright/brainstorm-concurrency.spec.js
```

## Test Cases

### Feature: Plan-lane concurrency limit
- [ ] TC-1: While this track holds `plan:running`, a second queued track
      (`Brainstorm B`) does not also enter `plan:running` — expected:
      `lanes.plan.parallel_limit: 1` in `conductor/workflow.json` is
      respected.
- [ ] TC-2: This track reaches `plan:success` without manual
      intervention — expected: worker frees the slot and the second track
      is then allowed to start.

## Acceptance Criteria
- [ ] Playwright spec `brainstorm-concurrency.spec.js` passes
- [ ] No regressions in related features
