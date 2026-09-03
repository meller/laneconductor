# Tests: Track 10016 — last_run.log staging

## Test Commands
```bash
# This track's fast static guards (TC-1, TC-6)
node conductor/tests/track-10016-last-run-log.test.mjs

# Live spawned-worker coverage (TC-2..TC-5) — updated in place, was
# originally written for track 1102's F9b and asserted the OPPOSITE
node conductor/tests/track-1102-f9b-log-staging.test.mjs

# Regression: the exit handler's index.md write/commit path shares `workDir`
node conductor/tests/track-1102-f9-index-producer.test.mjs
```

Note: run these with plain `node <file>.mjs`, not `node --test <file>.mjs`
— the latter double-invokes node:test's `run()` in this repo's test files
and produces a "being called recursively" warning with no test output.

## Test Cases

### Phase 1: remove the dead `git add`, lock in the hoist

- [ ] TC-1: **Hoist guard (must already pass on `main`).** Parse
      `conductor/laneconductor.sync.mjs`'s `spawnCli` exit handler and
      assert `const workDir = worktreePath || process.cwd()` appears
      exactly once, at a scope depth enclosing both the `if (lastRunLog)`
      and `if (updated)` blocks, and is not redeclared inside either.
      Expected: pass before and after this track's change — it guards
      `edb01b0` against a future refactor, it does not re-fix it.
      Covers AC-1.
- [ ] TC-2: **The warning reproduces, then stops.** Run a real spawned
      worker lane action (worktree-enabled, real git, `LC_SKIP_GIT_LOCK`
      *not* set for the git-touching parts) that produces log output, and
      capture the worker's stdout/stderr. Expected **before** the fix:
      output contains `Failed to stage last_run.log`. Expected **after**:
      it does not. Covers AC-2. This is the only test that must fail
      first — write and run it against unmodified `main` to see the
      warning before touching Task 2.
- [ ] TC-3: **The write still happens.** After the TC-2 run,
      `<track>/last_run.log` exists on disk and is non-empty, and its
      content equals the tail of the run's log file (i.e. what
      `tailLog(logPath, 100)` returned). Expected: pass before and after
      — REQ-5 guards against "fixing" this by deleting the write along
      with the `git add`. Covers AC-3.
- [ ] TC-4: **Nothing lands in git's index or worktree status.** After the
      TC-2 run, `git status --porcelain` in that run's working directory
      contains no entry for `last_run.log` in any state — not `A `, not
      `??`, not `M `. Expected: pass. Covers AC-4, and is the assertion
      that fails loudly if someone reaches for `git add -f`.
- [ ] TC-5: **The ignore rule is intact.** `git check-ignore -v` on the
      track's `last_run.log` exits 0 and reports a match against `*.log`.
      Expected: pass — catches "solving" AC-4 by un-ignoring the file or
      adding a `!last_run.log` negation. Covers AC-5.

### Phase 2: document the artifact's status

- [ ] TC-6: `conductor/product.md`'s file-roles table contains a row whose
      path cell names `last_run.log`, and that row's text states it is
      gitignored / not a committed artifact. Expected: fail before Phase
      2, pass after. Covers AC-6.
- [ ] TC-7: `grep -rn "last_run.log" conductor/*.md .claude/skills/laneconductor/`
      surfaces no statement that the file is committed or staged.
      Expected: pass — manual read of the hits is acceptable here; this is
      a documentation-consistency check, not an automatable assertion.

## Acceptance Criteria

- [x] TC-2 was observed **failing** against unmodified `main` before any
      code change — confirmed via the strongest available evidence: added
      a production-matching `.gitignore` to `track-1102-f9b-log-staging
      .test.mjs`'s scratch fixture and reran against unmodified code
      (real spawned worker, real git). `Failed to stage last_run.log`
      fired and the pre-existing test's own "must be tracked" assertion
      failed — proof the prior F9b fix never actually worked in a
      repo shaped like this one.
- [x] TC-1, TC-6 pass (new fast static guards,
      `track-10016-last-run-log.test.mjs`, `pass 2, fail 0`).
- [x] TC-2..TC-5 pass after the fix, via the updated
      `track-1102-f9b-log-staging.test.mjs` (`pass 1, fail 0`).
- [x] No regressions in `conductor/tests/track-1102-f9-index-producer.test.mjs`
      (`pass 1, fail 0`, unaffected by this track's edit).
- [x] No `*.log` file appears in `git status`/`git ls-files` in any test
      fixture after these runs — confirmed via `git ls-files` returning
      empty and `git check-ignore -v` matching `*.log`.
