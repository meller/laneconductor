# Tests: Track 1114 — Worktrees Panel Deep Link Autopilot Cleanup

## Test Commands
```bash
# Conductor (worker/dispatch) unit tests — node:test, zero deps
node --test conductor/tests/*.test.mjs

# UI unit tests — Vitest
cd ui && npm test
```

## Test Cases

### `resolveWorktreeAddArgs` (`conductor/tests/track-1114-worktree-create-args.test.mjs`)
- [x] TC-1: branch does not exist yet — creates fresh with `-B` — expected: `['worktree','add','-B',branch,path,startPoint]`
- [x] TC-2: branch already exists — checks it out as-is, no `-B` — expected: `['worktree','add',path,branch]`, never resets

### `classifyAutoCompleteOutcome` (`conductor/tests/track-1114-auto-complete.test.mjs`)
- [x] TC-3: lane advances on success → `{ action: 'advance' }`
- [x] TC-4: reaches `done:success` → `{ action: 'merge' }`
- [x] TC-5: same lane on failure (no advance) → `{ action: 'stop' }`, no auto-retry
- [x] TC-6: still `running` → `{ action: 'wait' }`

### `belongsInWorktreesPanel` (`conductor/tests/track-1114-worktrees-panel-scope.test.mjs`)
- [x] TC-7: `open` row with no live worktree → excluded
- [x] TC-8: `stranded` row with no live worktree → kept (the orphaned-but-ready-to-merge case the panel exists to catch)

### `computeWorktreeStats` (`ui/src/lib/worktreeStats.test.js`)
- [x] TC-9: counts per classification + total dirty files
- [x] TC-10: `open` count over threshold → warning recommendation
- [x] TC-11: `open` count at/below threshold → no warning
- [x] TC-12: `stranded` rows present → singular/plural wording correct
- [x] TC-13: empty row list → zero stats, no recommendations

### `shouldWriteForceDoneMarker` / `applyDoneSuccessMarkers` (`conductor/tests/track-1114-force-merge-marker.test.mjs`) — Phase 7
- [x] TC-14: force + not-done + live worktree → writes marker
- [x] TC-15: force + already `done:success` → does not write (nothing to force)
- [x] TC-16: `force` not set → never writes, regardless of lane state
- [x] TC-17: `stranded` row with no live worktree → does not write, falls back to plain git-only force merge
- [x] TC-18: `hasWorktree: true` but no `worktreePath` → does not write
- [x] TC-19: replaces existing `**Lane**`/`**Lane Status**` markers in place, leaves other markers untouched, no duplication
- [x] TC-20: `**Lane**` replace does not bleed into `**Lane Status**` (prefix collision)
- [x] TC-21: appends both markers when neither is present yet

### `nextArmedState` (`ui/src/lib/armedConfirm.test.js`) — Phase 7
- [x] TC-22: first click on a key arms it, does not fire
- [x] TC-23: second click on the same armed key fires and disarms
- [x] TC-24: click on a different key while another is armed re-arms to the new key, does not fire
- [x] TC-25: re-arming a different row's key never fires the previously-armed row's action

### `computeStaleKeys` / `computeStillPresentKeys` (`ui/src/lib/worktreePendingKeys.test.js`) — Phase 7
- [x] TC-26: row-scoped keys included correctly (remove key always; merge/complete/force keys only when `row.track` exists)
- [x] TC-27: pending key stale once its row disappears (removed or merged out of the unmerged list) — the exact computation bug #8's stale closure prevented from ever running correctly
- [x] TC-28: pending key NOT stale while its row is still present under the same identity
- [x] TC-29: pending key for a completed action clears once the row is fully absent from the next fetch
- [x] TC-30: only the stale key is returned when multiple pending keys exist and just one row disappears

## Acceptance Criteria
- [x] All unit tests pass (`node --test conductor/tests/*.test.mjs` — 222/229; `cd ui && npm test` — 291/302; all failures pre-existing and unrelated to this track's diff, confirmed via `git stash`)
- [x] No regressions in related features (Deep link, Complete & Merge, Force Merge, Remove Worktree, armed-confirm buttons, pending-state, stats header, refresh — all previously live-verified this session; this pass only extracted logic into pure modules with identical behavior, no functional change)
