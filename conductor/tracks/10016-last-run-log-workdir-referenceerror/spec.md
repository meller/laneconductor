# Spec: last_run.log workDir ReferenceError

## Problem Statement

`spawnCli()`'s exit handler references the local variable `workDir`
inside the `if (lastRunLog)` block before it is declared (`const
workDir = worktreePath || process.cwd();` lives in a later, sibling
`if (updated)` block). This throws a `ReferenceError` on nearly every
run, silently swallowed by an empty `catch (e) {}`, so `last_run.log`
is written to disk but never `git add`ed.

## Requirements

- REQ-1: `workDir` must be computed once, in a scope visible to every
  place inside this exit handler that needs it (at minimum both the
  `if (lastRunLog)` and `if (updated)` blocks), not redeclared locally
  inside just one of them.
- REQ-2: `last_run.log` must actually be staged (`git add`) as part of
  the same commit as the index.md update that follows it, for both
  worktree and non-worktree (local-fs / no worktree) runs.

## Acceptance Criteria

- [ ] A real spawned worker run (worktree-enabled) that produces log
      output results in `last_run.log` being present in `git show
      HEAD --stat` for the commit spawnCli's exit handler makes, not
      just present on disk.
- [ ] No `ReferenceError` (or any other silently-swallowed exception)
      occurs in this code path — verified by removing the empty catch
      block during testing (temporarily let it throw) to confirm the
      fix, then restoring reasonable error handling that still surfaces
      a real failure instead of hiding it completely.
