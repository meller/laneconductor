# Tests: Track AM-10087 — Blocked-turn park override discards a lane action's own already-resolved verdict

## Test Commands
```bash
# New pure unit tests for the verdict marker helper
node --test conductor/tests/track-10087-verdict-marker.test.mjs

# New real-worker spawn test reproducing the AM-1018 shape
node --test conductor/tests/track-10087-blocked-verdict-override.test.mjs

# Existing park/blocked-turn regression coverage — must stay green
node --test conductor/tests/track-10055-waiting-any-lane.test.mjs
```

## Test Cases

### Phase 1 — `parseVerdict` / `writeVerdict` / `clearVerdict` (conductor/services/verdict.mjs)
- [x] TC-1a: `parseVerdict` returns `'pass'` for `**Verdict**: pass`
- [x] TC-1b: `parseVerdict` returns `'fail'` for `**Verdict**: fail`
- [x] TC-1c: `parseVerdict` is case-insensitive (`**Verdict**: PASS`, `**Verdict**: Fail`)
- [x] TC-1d: `parseVerdict` returns `null` when the marker is absent
- [x] TC-1e: `parseVerdict` returns `null` for an empty marker value (`**Verdict**:   `)
- [x] TC-1f: `parseVerdict` returns `null` for an unrecognized value (`**Verdict**: maybe`) —
      never guessed
- [x] TC-1g: `writeVerdict` updates an existing marker in place (no duplicate line)
- [x] TC-1h: `writeVerdict` appends the marker when absent, without disturbing other markers
      (`**Lane**`, `**Lane Status**`, `**Progress**`)
- [x] TC-1i: `clearVerdict` removes the marker entirely; no-op when the marker is already absent

### Phase 3 — exit handler: blocked-turn override vs. resolved verdict
(Covered end-to-end by Phase 4's spawn tests below — the exit handler has no pure-unit seam of
its own; it's read via `parseVerdict` in the same block that already reads `agentWaitingReason`.)

### Phase 4 — real-worker spawn: `track-10087-blocked-verdict-override.test.mjs`
- [x] TC-2a (AM-1018 reproduction): a `review` dispatch whose mock-cli both emits a `blocked`
      `post_turn_summary` AND writes `**Verdict**: fail` + `**Lane**: implement` +
      `**Lane Status**: queue` to the worktree's `index.md` (the transition
      `review.on_failure` actually prescribes) lands the track at `implement:queue`, not
      `review:waiting`. `**Waiting Reason**` is absent on the resulting `index.md`.
- [x] TC-2b: same as TC-2a but `**Verdict**: pass` + the `review.on_success` transition — lands
      at `quality-gate:queue`, not `review:waiting`.
- [x] TC-2c (no verdict — regression guard): a `blocked` `post_turn_summary` with NO
      `**Verdict**` marker written still parks the track at `<lane>:waiting` with a non-empty
      `**Waiting Reason**` — unchanged from current behavior. Covers the genuine "should I apply
      this destructive migration?" case.
- [x] TC-2d (misconfigured fallback): `**Verdict**: pass` written, but the test's `workflow.json`
      fixture defines no `on_success` for the dispatched lane — falls back to parking at
      `<lane>:waiting` with a `**Waiting Reason**`, not a guessed transition.
- [x] TC-2e: a `conversation.md` comment documenting the override is present after TC-2a/TC-2b
      (not silent) — absent after TC-2c/TC-2d (those are ordinary parks, not overrides).

### Regression
- [x] All existing cases in `conductor/tests/track-10055-waiting-any-lane.test.mjs` still pass
      unmodified.
- [x] Any other existing test referencing `isBlockedTurn`/`extractBlockedQuestion`/
      `post_turn_summary` (`conductor/tests/stream-json-tail.test.mjs`) still passes unmodified.

## Acceptance Criteria
- [x] All unit tests pass (Phase 1 helper tests)
- [x] The AM-1018 reproduction (TC-2a) passes: resolved FAIL verdict + blocked annotation routes
      to `implement:queue`, not `review:waiting`
- [x] The genuine-open-question regression guard (TC-2c) passes: no verdict marker still parks
      with a `**Waiting Reason**`
- [x] The misconfiguration fallback (TC-2d) passes: an unroutable verdict still parks, never
      guesses
- [x] The override is visible in `conversation.md` when it fires (TC-2e)
- [x] No regressions in `track-10055-waiting-any-lane.test.mjs` or other existing blocked-turn
      tests
