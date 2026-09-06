# Track AM-10073: Three-way merge for worktree→primary track-doc sync

## Phase 1: Merge-base cache

**Problem**: A three-way merge needs a common ancestor, and nothing today records what
the two copies of a track doc last agreed on.
**Solution**: A small pure module that stores the worktree content last merged into
primary, per track and per artifact, under `conductor/.doc-sync/<trackNumber>/<file>`.

- [ ] Task 1: Create `conductor/services/doc-sync-base.mjs` with `docSyncBasePath`,
      `readDocSyncBase`, `writeDocSyncBase`, `clearDocSyncBase` (REQ-2)
    - [ ] Sub-task: Model it on `conductor/services/run-marker.mjs` — path helper plus
          tolerant IO, no process-global state, missing or unreadable cache returns `null`
    - [ ] Sub-task: `writeDocSyncBase` creates the track directory recursively
    - [ ] Sub-task: `clearDocSyncBase` removes the whole track directory, no-op if absent
- [ ] Task 2: Add `conductor/.doc-sync/` to `.gitignore` beside the existing
      `conductor/.runs/` and `conductor/.locks/` entries, with a comment saying what it is
- [ ] Task 3: Write the Phase 1 unit tests from `test.md` first, confirm they fail, then
      make them pass

**Impact**: Machine-local state only. Nothing reads the cache yet, so this phase changes
no behavior.

## Phase 2: Three-way merge primitive

**Problem**: There is no merge function in the codebase for full file contents — only
`mergeIndexMarkers`, which is marker-level and specific to `index.md`.
**Solution**: Wrap `git merge-file -p` behind a small pure-string interface, so callers
never handle temp files or exit codes.

- [ ] Task 1: Create `conductor/services/three-way-merge.mjs` exporting
      `threeWayMerge({ ours, base, theirs })` → `{ status, content, error? }` (REQ-3)
    - [ ] Sub-task: Write the three contents into a unique temp directory, invoke
          `git merge-file -p -L primary -L base -L worktree`, capture stdout
    - [ ] Sub-task: Map exit `0` → `clean`, positive → `conflict`, negative or thrown →
          `error`; return merged content only for `clean` (REQ-6, REQ-13)
    - [ ] Sub-task: Always clean up the temp directory, including on the error path
- [ ] Task 2: Write the Phase 2 unit tests first (clean merge, conflicting merge,
      identical inputs, `git` failure), confirm they fail, then make them pass

**Impact**: A new standalone primitive. Still no caller, so still no behavior change.

## Phase 3: Replace the blind copy in `copyWorktreeArtifactsToPrimary`

**Problem**: This is the actual bug — `copyFileSync(src, dest)` for every artifact that
is not `index.md`.
**Solution**: Route those four artifacts through the merge base and the merge primitive,
and make "the worktree has nothing new" the skip condition instead of mtime.

- [ ] Task 1: In `conductor/services/worktree-artifact-merge.mjs`, replace the non-index
      `else` branch with the merge path (REQ-1)
    - [ ] Sub-task: Read the merge base; if the worktree content equals it, skip the
          artifact and write nothing (REQ-5)
    - [ ] Sub-task: On no base, seed it — `git show <merge-base>:<path>` first, primary's
          current content as the fallback — then merge in the same pass (REQ-7)
    - [ ] Sub-task: Clean merge writes primary, then sets the base to the worktree's
          content, and pushes the file into `copied` (REQ-4)
    - [ ] Sub-task: Conflict or merge error pushes `{ file, reason }` into `skipped` and
          writes nothing to either side (REQ-6, REQ-13)
- [ ] Task 2: Keep the suspicious-shrink guard ahead of the merge, unchanged, and leave
      its `skipped` entry shape alone (REQ-10)
- [ ] Task 3: Replace the mtime pre-filter for these four artifacts with the base
      comparison; leave `index.md`'s mtime-lies exception and its `LANE_STATUS_RE`
      override exactly as they are (REQ-5, REQ-11)
- [ ] Task 4: Confirm all three callers get the new behavior with no per-caller branch,
      and that `isSuccess: true` no longer permits a wholesale overwrite (REQ-9)
- [ ] Task 5: Write the Phase 3 tests first — including a direct reproduction of the
      track-10067 revert — confirm they fail against the current code, then make them pass

**Impact**: The core fix. Primary-side edits to `plan.md`, `spec.md`, `test.md`, and
`quality-gate.md` survive both the periodic pass and the exit handler.

## Phase 4: Merge-base lifecycle

**Problem**: Phase 3's seed-on-missing fallback is the weak path; it should be rare, and
a track's cache must not outlive its worktree.
**Solution**: Seed at worktree creation, where the two sides are provably identical, and
clear at worktree removal.

- [ ] Task 1: Seed the base for every artifact present in the new worktree at the end of
      `createWorktree()` in `conductor/laneconductor.sync.mjs` (REQ-8)
- [ ] Task 2: Call `clearDocSyncBase()` from `removeWorktree()` (REQ-8)
    - [ ] Sub-task: Best-effort — a failure here must not break worktree removal
- [ ] Task 3: Write the Phase 4 tests first, confirm they fail, then make them pass

**Impact**: The common case now always has an exact merge base. The `git show` and
primary-content fallbacks become recovery paths for restarts and pre-existing worktrees.

## Phase 5: Surface declined merges

**Problem**: A declined conflict that nobody sees is a doc that quietly stops updating on
the board.
**Solution**: Reuse the existing `staleDocSignal` transition machinery in
`syncWorktreeDocsToPrimary()`, with conflict-specific wording.

- [ ] Task 1: In `conductor/laneconductor.sync.mjs`, make the `skipped` handler's message
      depend on `skip.reason` rather than always describing a size comparison (REQ-12)
    - [ ] Sub-task: `merge-conflict` → name the file and say both copies were preserved
          and what resolves it
    - [ ] Sub-task: `merge-error` → name the file and the underlying error
    - [ ] Sub-task: `suspicious-shrink` keeps its current wording verbatim
- [ ] Task 2: Confirm the one-notice-per-transition behavior still holds, so a conflict
      that persists for an hour posts once, not sixty times
- [ ] Task 3: Write the Phase 5 tests first, confirm they fail, then make them pass

**Impact**: A conflict becomes a visible, actionable comment in the Conversation tab
instead of a doc that silently stops advancing.

## Phase 6: Verification

**Problem**: Every prior fix in this area (Tracks 1112, 1102 F21, 10019, 10053, 10064) was
confirmed by a live incident, not by a unit test, and each one narrowed the behavior of
the same function.
**Solution**: Run the existing suites that cover this module before claiming the phase
work is done, and drive the real product once.

- [ ] Task 1: Run the full new suite plus every existing test that touches this module —
      `track-1112-worktree-artifact-merge`, `track-1110-copy-worktree-artifacts`,
      `track-1102-f21-mid-run-doc-sync-clobber`, `track-10055-waiting-any-lane`,
      `track-10038-bookkeeping-conflict-widen`, `track-1035-worktree-lifecycle` — and
      confirm no regressions
- [ ] Task 2: Restart the worker (it does not hot-reload), start a real track in a
      worktree, edit its `plan.md` in the primary checkout, and record the observed
      content after the next doc-sync tick
- [ ] Task 3: Grep the changed files for stubs and leftover TODO/FIXME markers
- [ ] Task 4: Update `conductor/product.md`'s section on worktree doc sync to describe the
      merge-base model, so the next person to touch this function does not have to
      reconstruct it from the comment archaeology
