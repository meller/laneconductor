# Track 10016: last_run.log never gets git-added — workDir referenced before declaration

**Lane**: implement
**Merge Mode**: direct
**Lane Status**: queue
**Progress**: 100%
**Last Run**: claude/claude-sonnet-5 (primary)
**Phase**: Implementation complete
**Type**: bug
**Track Kind**: bug
**Summary**: Removed the dead `git add` (can never succeed — last_run.log matches .gitignore's `*.log`) from spawnCli's exit handler; kept the unconditional writeFileSync. Also updated an existing regression…

## Problem

**As filed** — `spawnCli()`'s exit handler referenced `workDir` inside the
`if (lastRunLog)` block before it was declared (`const workDir` lived in
a later, sibling `if (updated)` block), throwing a `ReferenceError` into
an empty `catch (e) {}`, so `last_run.log` was written to disk but never
`git add`ed.

**As found during planning** — two things changed the picture:

1. **The scoping bug is already fixed in `main`.** Commit `edb01b0`
   ("fix(track-1102): F9b - fix workDir ReferenceError that skipped
   last_run.log staging") hoisted the declaration above both blocks and
   replaced the empty catch with a `console.warn`. That was this track's
   entire original Task 1 and Task 3.

2. **The fix still doesn't stage the file, and can't.** `.gitignore:17`
   has `*.log`, which matches `last_run.log`; git refuses to stage an
   explicitly-named ignored path without `-f` (exit 1, "The following
   paths are ignored by one of your .gitignore files"). Verified
   empirically in a scratch repo, and `git check-ignore -v` confirms the
   match on the real file. Corroboration: 89 `last_run.log` files exist
   under `conductor/tracks/`, and `git log --all -- '*last_run.log'`
   returns nothing — not one has ever been committed.

So the call went from silently dying on a `ReferenceError` to loudly
dying on the ignore rule. Since `edb01b0`, the worker prints `Failed to
stage last_run.log` on **every run that produces log output** — nearly
every run. F9b fixed a real defect but exposed that the call underneath
was never viable.

## Solution

Reject the original premise (committing per-run logs) rather than
implement it. `last_run.log` is a per-run runtime artifact in the same
category as `conductor/.runs/<track_number>.json`, which `product.md`
already documents as "gitignored, primary checkout only … Not a committed
artifact." Its only consumer — `/laneconductor implement` step 2 — reads
it off the local filesystem, which the unconditional `writeFileSync`
already provides.

- **Phase 1**: Delete the dead `git add` + `catch`/`console.warn` from
  the exit handler (keep the `writeFileSync`), replace the now-stale F9b
  comment, and add a source-level regression guard so the original hoist
  can't be undone.
- **Phase 2**: Add a `last_run.log` row to `product.md`'s file-roles
  table so the next reader doesn't re-file this same track.

`git add -f` / a `!last_run.log` ignore negation is the explicitly
**rejected** alternative — see `spec.md`. Full findings, requirements and
acceptance criteria in `spec.md`; phases in `plan.md`; test cases in
`test.md`.
**Auto Run**: yes
