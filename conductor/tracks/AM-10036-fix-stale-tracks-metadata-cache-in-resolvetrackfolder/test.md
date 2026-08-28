# Tests: Track AM-10036 — Fix stale tracks-metadata cache in resolveTrackFolder

## Test Commands
```bash
node --test conductor/tests/track-10036-tracks-metadata-cache.test.mjs

# Regression guard — anything exercising resolveTrackFolder/getTrackMetadata
node --test conductor/tests/track-1112-worktree-audit.test.mjs
```

## Test Cases

### Phase 1: Add the file watch + reload, with a regression test
- [ ] TC-1.1: `getTrackMetadata('N')` called before track N's entry
      exists returns `null` (establishes the stale-cache baseline).
- [ ] TC-1.2: After `tracks-metadata.json` gains an entry for N (written
      by a separate process/fs write) and the watcher's debounce elapses,
      `getTrackMetadata('N')` returns the new entry — no worker restart
      needed.
- [ ] TC-1.3: `resolveTrackFolder(tracksDir, 'N')` in the same scenario
      returns the real `INITIALS-N-slug` folder name, not `null`.
- [ ] TC-1.4: A worker that already has a *correct*, non-stale cache is
      unaffected by an unrelated write to `tracks-metadata.json` (e.g.
      `last_file_update` bumped for a different track) — no spurious
      reload side effects, no thrown errors on a malformed/mid-write file
      (chokidar can fire on a partial write; a `JSON.parse` failure in
      `loadTracksMetadata()` must not crash the watcher).

## Acceptance Criteria
- [ ] All new tests pass
- [ ] Full `conductor/tests/` suite stays green
- [ ] AC-1, AC-2, AC-3 from spec.md each verified with a recorded observation
