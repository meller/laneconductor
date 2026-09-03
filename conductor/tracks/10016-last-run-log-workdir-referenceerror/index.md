# Track 10016: last_run.log never gets git-added — workDir referenced before declaration

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Last Run**: claude/claude-opus-5 (primary)
**Phase**: New
**Type**: bug
**Summary**: Found live while investigating track 1102's F9 (gutted index.md). spawnCli()'s exit handler references `workDir` inside the `if (lastRunLog)` block before it's declared in a later, sibling `if…

## Problem

`conductor/laneconductor.sync.mjs`, inside `spawnCli()`'s exit handler
("Phase 5: Update Lane Status in files and commit"):

```js
// ~line 3996-4003
if (lastRunLog) {
  const lastRunLogPath = join(tracksDir, trackDir, 'last_run.log');
  writeFileSync(lastRunLogPath, lastRunLog, 'utf8');
  const relLogPath = join('conductor', 'tracks', trackDir, 'last_run.log');
  try { execSync(`git add "${relLogPath}"`, { cwd: workDir, stdio: 'pipe' }); } catch (e) { }
}

// ~line 4005-4009, a SIBLING block, not a parent of the above
if (updated) {
  const workDir = worktreePath || process.cwd();
  ...
}
```

`workDir` is declared with `const` inside `if (updated) { ... }` — its
scope doesn't extend to the earlier, sibling `if (lastRunLog) { ... }`
block. Referencing it there throws `ReferenceError: workDir is not
defined` every time this code path runs (i.e. whenever `lastRunLog` is
truthy, which is nearly always — `tailLog()` returns content for any
run that produced log output). The `try`/`catch (e) {}` around that
specific line swallows the error completely — no log, no warning,
nothing.

**Net effect**: `writeFileSync(lastRunLogPath, ...)` still runs first
(that line isn't inside the failing try/catch), so `last_run.log` does
get written to disk. But the subsequent `git add` for it silently never
happens — the file exists as an untracked/unstaged change every single
run, never committed alongside the index.md update that runs right
after it in the very next block.

## Solution

Not yet designed — the fix is small (compute `workDir` once, before
both blocks that need it, instead of only inside the second one), but
should be paired with a regression test that actually asserts
`last_run.log` gets staged (not just that no exception is thrown —
the current bug proves silent exceptions don't show up in normal
testing without specifically checking git's index state).
