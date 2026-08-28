# Track AM-10036: Fix stale tracks-metadata cache in resolveTrackFolder

## Phase 1: Add the file watch + reload, with a regression test

**Problem**: `tracksMetadata` is loaded once per worker process and never
invalidated, so a long-lived worker can't see tracks created after it
started — silently corrupting three different downstream decisions
(folder scaffolding, merge-mode routing, and anything else with a
null-folder fallback).

**Solution**: Mirror `workflow.json`'s existing watch/reload pattern for
`conductor/tracks-metadata.json`.

- [ ] Task 1: Add `watch('conductor/tracks-metadata.json', { ignoreInitial: true }).on('change', () => { tracksMetadata = loadTracksMetadata(); console.log('[config] tracks-metadata.json reloaded'); });` alongside the existing `workflow.json` watch (`laneconductor.sync.mjs:2586-2588`). (REQ-1)
- [ ] Task 2: Write a regression test — a real throwaway repo (same style
      as `conductor/tests/track-1112-worktree-audit.test.mjs`), write
      `tracks-metadata.json` without an entry for track `N`, call
      `getTrackMetadata('N')` once (populating the stale cache), then
      write a NEW entry for `N` to the file, wait for the watcher's
      debounce, and assert `getTrackMetadata('N')` now resolves it.
      (AC-1)
- [ ] Task 3: Same fixture, assert `resolveTrackFolder()` returns the
      real folder name after the file change, not `null`. (AC-2)
- [ ] Task 4: Run the full `conductor/tests/` suite, confirm no
      regressions. (AC-3)

**Impact**: A worker's track-metadata view stays correct for its entire
run, regardless of how long it's been alive or what got created after it
started — closing the root cause behind three real incidents on track
10035, not just papering over the symptoms again.
