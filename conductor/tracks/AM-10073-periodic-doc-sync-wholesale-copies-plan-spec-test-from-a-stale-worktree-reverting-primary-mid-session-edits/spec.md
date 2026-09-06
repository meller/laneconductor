# Spec: Three-way merge for worktree→primary track-doc sync

## Problem Statement

`copyWorktreeArtifactsToPrimary()` (`conductor/services/worktree-artifact-merge.mjs`)
treats `index.md` and everything else differently, and only `index.md` is safe.

`index.md` goes through `mergeIndexMarkers()` — a careful marker-level merge that
replaces individual `**Lane**` / `**Progress**` / `**Summary**` lines in the primary
checkout's own copy and leaves the rest of that file's body untouched.

`plan.md`, `spec.md`, `test.md`, and `quality-gate.md` go through the `else` branch and
get `copyFileSync(src, dest)` — a wholesale replacement of the primary copy with the
worktree's copy. There is no merge logic of any kind. The only thing between a live
worktree and the primary copy is a suspicious-shrink heuristic (declines when the
incoming file is under 50% of the existing one), which by construction cannot notice a
same-size or larger overwrite that happens to drop somebody else's paragraph.

These files have more than one writer on the primary side, so this is data loss, not a
theoretical race:

| Primary-side writer | Where |
|---|---|
| A human or a `workspace: main` lane action editing the file in the primary checkout | the confirmed track-10067 case |
| The Open Bug endpoint appending a regression-test block to `test.md` | `ui/server/index.mjs` `/open-bug` |
| The DB→FS pull writing `plan_content` / `spec_content` / `test_content` | `conductor/laneconductor.sync.mjs`, `ui/server/index.mjs` |

Two distinct failure modes, both silent:

**A — periodic doc-sync (`skipUnchanged: true`).** The mtime guard skips only while the
worktree's file is *not* newer than primary's. A live agent rewrites `plan.md` every few
minutes as it ticks checkboxes, so the worktree wins that comparison almost immediately
after any primary-side edit. The worktree's content was checked out *before* that edit,
so copying it wholesale reverts the edit. The next tick is 60 seconds away.

**B — exit handler and orphan reconcile (`skipUnchanged: false`).** No mtime check at
all. Every artifact that exists in the worktree is copied unconditionally, so a
primary-side edit made even *after* the worktree's last write is destroyed at run end.

Nothing anywhere reports the loss. The one notification path that exists
(`staleDocSignal` → a `⚠️ Docs may be stale` comment in `conversation.md`) fires only
when the shrink guard *declines* a copy. The failure here is the copy *succeeding*.

## Requirements

- **REQ-1** — A worktree→primary sync of `plan.md`, `spec.md`, `test.md`, or
  `quality-gate.md` must never discard a primary-side change that the worktree's copy
  does not contain. Both sides' edits survive, or neither side is written.

- **REQ-2** — Maintain a per-track, per-artifact **merge base**: the exact worktree
  content that was last successfully merged into primary. Stored in the primary checkout
  at `conductor/.doc-sync/<trackNumber>/<file>`, alongside the existing
  `conductor/.runs/` and `conductor/.locks/` machine-local runtime state, and added to
  `.gitignore` the same way.

- **REQ-3** — Merge with a real three-way merge: `git merge-file -p` with *ours* = the
  primary copy, *base* = the cached merge base, *theirs* = the worktree copy. `git` is
  already a hard dependency of every worktree code path, and `git merge-file` operates on
  three plain file paths without needing a repository, so this stays unit-testable in a
  temp directory.

- **REQ-4** — On a clean merge: write the merged content to primary, set the merge base
  to the worktree's current content (not the merged content — the base must track what
  the *other* side last had, so the next pass sees primary's accumulated edits as its own
  one-sided delta), and report the file in `copied`.

- **REQ-5** — When the worktree's content is byte-identical to the merge base, the
  worktree has nothing new to contribute: skip the artifact entirely, write nothing. For
  these four artifacts this replaces the mtime comparison, which is not a sound
  "unchanged" signal when the primary copy has independent writers bumping its mtime. The
  cost is one read of a few-KB file per artifact per live worktree per pass.

- **REQ-6** — On a conflicting merge: write nothing to primary and never write conflict
  markers into a file the board, the DB sync, and the conversation view all parse. Record
  the artifact in the returned `skipped` array with `reason: 'merge-conflict'`, and leave
  the worktree's copy untouched so neither side is lost. Retry on the next pass; the
  conflict clears on its own once either side's next edit makes the merge resolvable.

- **REQ-7** — When no merge base exists (worker restarted, or a worktree created before
  this feature shipped), seed one before merging, in this order:
  1. `git show <merge-base of the main branch and track-NNN>:<track-doc path>` run in the
     primary checkout — the true common ancestor when the doc is committed.
  2. Failing that (untracked doc, new track, detached branch), seed the base from the
     primary copy's current content.
  Then merge in the same pass. Fallback 2 is a deliberate accepted limitation: it treats
  primary's current state as agreed-upon, so a primary-side edit made *before* the seed
  and not yet committed is not protected on that one pass. It is never worse than today's
  unconditional overwrite, and REQ-8 keeps it a rare path.

- **REQ-8** — Seed the merge base at worktree creation (`createWorktree`), where the two
  sides are identical by construction and the base is therefore exactly right. Delete
  `conductor/.doc-sync/<trackNumber>/` in `removeWorktree`, so a track's cache never
  outlives its worktree.

- **REQ-9** — Apply this uniformly to all three callers of
  `copyWorktreeArtifactsToPrimary()`: the periodic doc-sync pass, the lane-action exit
  handler, and the orphaned-dispatch reconciler. `isSuccess: true` does not license a
  wholesale overwrite — a successful run is exactly when the worktree's copy is most
  likely to be blind-copied over a human's edit. Keeping one code path is also why this
  logic was extracted into a shared module in the first place (Track 1112).

- **REQ-10** — Keep the existing suspicious-shrink guard as an outer safety net, checked
  before any merge is attempted. A guard-declined artifact reports `reason:
  'suspicious-shrink'` exactly as it does today.

- **REQ-11** — `index.md` continues to go through `mergeIndexMarkers()` with its existing
  `skipStatusMarkers` / `trustRunningStatus` behavior, unchanged. `conversation.md`
  remains outside this module entirely (Track 10019 D3) — nothing here may touch it or
  its `.conv-cursor`.

- **REQ-12** — Every decline and every non-trivial merge is logged with the track, the
  file, and the reason. A conflict additionally posts a one-time `conversation.md` notice
  through the existing `staleDocSignal` transition machinery, with wording specific to a
  conflict rather than the shrink guard's size-comparison text.

- **REQ-13** — If `git merge-file` is unavailable or exits with an error status, fail
  closed: decline the artifact and report it. Never fall back to a blind copy.

## Acceptance Criteria

- [ ] A human edits `plan.md` in the primary checkout while a track's agent is running in
      its worktree; sixty seconds later the agent's newly-ticked checkboxes are visible in
      the primary copy **and** the human's edit is still there.
- [ ] The same holds at run end, when the exit handler copies artifacts back — the
      human's edit survives a successful run, not just a mid-run tick.
- [ ] A regression test appended to `test.md` through the UI's Open Bug button is still
      present in `test.md` after the running track's next doc-sync pass.
- [ ] When both sides edited the same lines and the merge cannot be resolved, the primary
      copy is left exactly as the human wrote it, the worktree copy is left exactly as the
      agent wrote it, and a `⚠️` comment naming the conflicting file appears in the
      track's Conversation tab.
- [ ] No track doc anywhere in the repo ever contains `<<<<<<<` conflict markers written
      by this sync.
- [ ] Restarting the worker mid-run does not cause the next doc-sync pass to revert a
      primary-side edit.
- [ ] Removing a track's worktree leaves no `conductor/.doc-sync/<trackNumber>/` directory
      behind.

## API Contracts / Data Models

### New module: `conductor/services/doc-sync-base.mjs`

```js
docSyncBasePath(primaryRoot, trackNumber, file) -> string
readDocSyncBase(primaryRoot, trackNumber, file)  -> string | null
writeDocSyncBase(primaryRoot, trackNumber, file, content) -> void
clearDocSyncBase(primaryRoot, trackNumber) -> void          // whole track dir
```

Mirrors `conductor/services/run-marker.mjs`: pure path/IO helpers, no process-global
state, tolerant of a missing or unreadable cache (treated as "no base").

### New primitive: `threeWayMerge()` in `conductor/services/three-way-merge.mjs`

```js
threeWayMerge({ ours, base, theirs }) -> { status: 'clean' | 'conflict' | 'error', content: string | null, error?: string }
```

Takes the three contents as strings, writes them to a temp directory, shells out to
`git merge-file -p -L primary -L base -L worktree`, and maps the exit status: `0` →
`clean`, positive → `conflict`, negative or a thrown error → `error`. Returns merged
content only for `clean`.

### Changed: `copyWorktreeArtifactsToPrimary()`

Same signature. The non-`index.md` branch changes from `copyFileSync` to the merge path
above. The returned `skipped` entries gain two new `reason` values, `'merge-conflict'`
and `'merge-error'`, each carrying `{ file, reason }`; `'suspicious-shrink'` keeps its
existing `incomingSize` / `existingSize` fields.

## Non-Goals

- The **DB→FS pull** (`laneconductor.sync.mjs` writing `planContent`/`specContent`/
  `testContent`, and `ui/server/index.mjs`'s `sync-to-file` recreate path) also
  blind-writes these same three files on primary. That is the same class of bug in a
  different direction and deserves its own track; this one is scoped to worktree→primary.
- `conversation.md` keeps its existing `.conv-cursor` ownership and stays out of this
  module.
- No new dependency: the merge uses `git merge-file`, not a bundled diff3 library.
