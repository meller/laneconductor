# Tests

## Test Commands
```bash
cd ui && npx vitest run src/components/TrackDetailPanel.conversation-scroll.test.jsx
```

## Test Cases

### Feature: Conversation tab auto-scroll gating

File: `ui/src/components/TrackDetailPanel.conversation-scroll.test.jsx`

- [x] TC-1: Auto-scrolls to bottom on first opening the Conversation tab
      (comments already exist) — expected: `scrollIntoView` called.
- [x] TC-2: A 2s poll tick that returns the same comment count (fresh
      array reference, same length) does not trigger an additional scroll
      — expected: `scrollIntoView` call count unchanged after two poll
      ticks.
- [x] TC-3: A poll tick that adds a new comment, with the user near the
      bottom of the scroll container, auto-scrolls to the new comment —
      expected: `scrollIntoView` called again.
- [x] TC-4: A poll tick that adds a new comment while the user has
      scrolled away from the bottom does not move their scroll position —
      expected: no additional `scrollIntoView` call.

Verified these tests fail against the pre-fix implementation (reverted the
effect to the naive `[comments, tab]`-only version locally, confirmed TC-2
and TC-4 fail, restored the fix) — see Phase 1/2 notes in `plan.md`.

## Acceptance Criteria
- [x] All 4 new test cases pass against the current implementation.
- [x] TC-2 and TC-4 were confirmed to fail against the pre-fix code (proves
      they actually exercise the bug, not just the happy path).
- [x] No regressions in `TrackDetailPanel.test.jsx` (3 tests) or
      `TrackDetailPanel.mobile.test.jsx` (8 tests) — full related suite
      (15 tests) passes.
