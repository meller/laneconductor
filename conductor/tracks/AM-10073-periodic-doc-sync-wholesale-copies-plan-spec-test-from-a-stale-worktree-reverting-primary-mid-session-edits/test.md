# Tests: Track AM-10073 — Three-way merge for worktree→primary track-doc sync

## Test Commands

```bash
# The new suite for this track
node --test conductor/tests/track-10073-doc-sync-three-way-merge.test.mjs

# Existing suites that cover the function being changed — must stay green
node --test conductor/tests/track-1112-worktree-artifact-merge.test.mjs
node --test conductor/tests/track-1110-copy-worktree-artifacts.test.mjs
node --test conductor/tests/track-1102-f21-mid-run-doc-sync-clobber.test.mjs
node --test conductor/tests/track-10055-waiting-any-lane.test.mjs
node --test conductor/tests/track-1035-worktree-lifecycle.test.mjs
node --test conductor/tests/track-10038-bookkeeping-conflict-widen.test.mjs

# Vitest suites (worker unit + server API)
npm test
cd ui && npm test
```

New tests go in `conductor/tests/track-10073-doc-sync-three-way-merge.test.mjs`, using
`node:test` — this exercises the filesystem and shells out to `git`, which is exactly what
`conductor/tech-stack.md` reserves `node:test` for.

## Test Cases

### Phase 1: Merge-base cache (`doc-sync-base.mjs`)

- [ ] TC-1: `docSyncBasePath(root, '10073', 'plan.md')` — expected:
      `<root>/conductor/.doc-sync/10073/plan.md`
- [ ] TC-2: `readDocSyncBase` on a track with no cache — expected: `null`, no throw
- [ ] TC-3: `writeDocSyncBase` into a non-existent track directory — expected: directory
      created, content readable back byte-for-byte by `readDocSyncBase`
- [ ] TC-4: `readDocSyncBase` on an unreadable or corrupt cache entry — expected: `null`,
      no throw, treated the same as no base
- [ ] TC-5: `clearDocSyncBase` on a populated track directory — expected: directory gone;
      calling it again on the now-absent directory — expected: no throw
- [ ] TC-6: `conductor/.doc-sync/` is matched by `.gitignore` — expected:
      `git check-ignore conductor/.doc-sync/10073/plan.md` exits 0

### Phase 2: Three-way merge primitive (`three-way-merge.mjs`)

- [ ] TC-7: Both sides edited different regions of the base — expected: `status: 'clean'`,
      `content` contains both edits
- [ ] TC-8: Only `theirs` changed — expected: `status: 'clean'`, `content` equals `theirs`
- [ ] TC-9: Only `ours` changed — expected: `status: 'clean'`, `content` equals `ours`
- [ ] TC-10: All three identical — expected: `status: 'clean'`, `content` equals the input
- [ ] TC-11: Both sides rewrote the same line differently — expected:
      `status: 'conflict'`, `content` is `null`
- [ ] TC-12: Returned content for a clean merge never contains `<<<<<<<`, `=======`, or
      `>>>>>>>` markers
- [ ] TC-13: `git` invocation fails (simulated via a `PATH` with no `git`) — expected:
      `status: 'error'`, `content` is `null`, `error` populated
- [ ] TC-14: The temp directory used for the merge is removed afterward, on both the clean
      and the error path

### Phase 3: `copyWorktreeArtifactsToPrimary` merge path

- [ ] TC-15 (**the track-10067 reproduction — must fail against current code**): worktree
      and primary both start from the same `plan.md`; primary gains a new line; the
      worktree ticks a checkbox and its mtime is set newer than primary's; run the copy
      with `skipUnchanged: true, isSuccess: false` — expected: primary's `plan.md` contains
      **both** the new line and the ticked checkbox, `copied` includes `plan.md`
- [ ] TC-16: Same setup with `skipUnchanged: false, isSuccess: true` (the exit-handler
      path) — expected: identical outcome; a successful run does not license an overwrite
- [ ] TC-17: Worktree content byte-identical to the merge base — expected: `copied` is
      empty, primary's file untouched, primary's mtime unchanged
- [ ] TC-18: Worktree content identical to base but primary's mtime is *newer* (the DB↔FS
      churn case) — expected: still skipped, and the newer mtime alone never triggers a
      write in either direction
- [ ] TC-19: Both sides edited the same line — expected: `copied` excludes the file,
      `skipped` contains `{ file: 'plan.md', reason: 'merge-conflict' }`, primary's file is
      byte-identical to what the human wrote, worktree's file is byte-identical to what the
      agent wrote
- [ ] TC-20: After a clean merge, the merge base equals the **worktree's** content, not the
      merged content — then a second worktree-only edit merges cleanly on the next call and
      still preserves primary's earlier edit (proves the base-update rule of REQ-4 across
      two consecutive passes)
- [ ] TC-21: `test.md` with an Open-Bug-style regression block appended on primary while
      the agent rewrote a different section in the worktree — expected: the regression block
      is present in primary afterward
- [ ] TC-22: `spec.md` and `quality-gate.md` follow the same merge path as `plan.md`
- [ ] TC-23: `index.md` still goes through `mergeIndexMarkers` — a worktree `index.md`
      whose body differs wholesale from primary's leaves primary's body intact and only
      replaces markers (regression guard on REQ-11)
- [ ] TC-24: `conversation.md` is never read or written by this function, even when present
      and different on both sides (regression guard on Track 10019 D3)
- [ ] TC-25: A worktree artifact under 50% the size of primary's with `isSuccess: false` —
      expected: declined with `reason: 'suspicious-shrink'` before any merge is attempted,
      and the merge base is not updated
- [ ] TC-26: No merge base and the doc is committed on both branches — expected: base
      seeded from the `git show` merge-base content, merge proceeds, both edits survive
- [ ] TC-27: No merge base and the doc is untracked — expected: base seeded from primary's
      current content, worktree's changes merge in cleanly, nothing on primary is lost
- [ ] TC-28: `threeWayMerge` returns `status: 'error'` — expected: `skipped` contains
      `reason: 'merge-error'`, primary's file untouched, no blind copy anywhere (REQ-13)

### Phase 4: Merge-base lifecycle

- [ ] TC-29: `createWorktree()` seeds a base for every artifact present in the new
      worktree — expected: `conductor/.doc-sync/<track>/plan.md` exists and matches the
      worktree's copy
- [ ] TC-30: `removeWorktree()` clears the track's cache — expected:
      `conductor/.doc-sync/<track>/` no longer exists
- [ ] TC-31: `clearDocSyncBase` throwing does not prevent worktree removal from completing

### Phase 5: Surfacing declined merges

- [ ] TC-32: A `merge-conflict` skip posts exactly one `conversation.md` comment naming the
      conflicting file, prefixed `> **system**: ⚠️`, per the conversation.md format protocol
- [ ] TC-33: The same conflict persisting across ten doc-sync passes still posts exactly
      one comment (the `staleDocSignal` transition guard)
- [ ] TC-34: Once the conflict resolves and the file syncs, the signal clears; a later
      conflict on the same file posts a fresh comment
- [ ] TC-35: A `suspicious-shrink` skip posts the existing size-comparison wording, byte
      for byte unchanged from today

### Phase 6: Real-product verification

- [ ] TC-36: Worker restarted, a real track running in a worktree, `plan.md` edited by hand
      in the primary checkout — expected: after the next doc-sync tick the primary copy
      shows the agent's latest progress **and** the hand-edit; record the observed content
- [ ] TC-37: `grep -rn '<<<<<<<' conductor/tracks/` finds nothing after a full run

## Acceptance Criteria

- [ ] All new tests in `track-10073-doc-sync-three-way-merge.test.mjs` pass
- [ ] TC-15 is confirmed to fail against the pre-fix code and pass after
- [ ] Every existing suite listed under Test Commands passes with no regressions
- [ ] `npm test` and `cd ui && npm test` pass
- [ ] No stubs, TODOs, or FIXMEs in the changed code paths
- [ ] TC-36's observation is recorded in `conversation.md` before the track leaves review
