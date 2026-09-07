# Tests: Track AM-10077 — Reconcile Track 10050's Split State And Land Its Unshipped Fix

## Test Commands

```bash
# Ported 10050 suites (Phase 2) — must fail before the port, pass after
node --test conductor/tests/track-10050-worktree-start-point.test.mjs
node --test conductor/tests/track-10050-worktree-base-e2e.test.mjs
node --test conductor/tests/track-10050-lock-cli.test.mjs

# New audit suite (Phase 3)
node --test conductor/tests/track-10077-merge-mode-fallback.test.mjs

# Regression sweep
node --test conductor/tests/
cd ui && npm test
```

Note: `node --test` in this repo has leaked orphaned worker and mock-collector
child processes before. Check `ps aux | grep laneconductor.sync` after any run
that spawns a worker, and kill strays before trusting subsequent state.

---

## Test Cases

### Phase 1: Folder split and false success

- [ ] TC-1: Every one of the five redundant 10050 directories, diffed against
      the registered `TU-10050-...`, contains no file or comment the survivor
      lacks — expected: no unique content, deletion is safe
- [ ] TC-2: After deletion, exactly one directory under `conductor/tracks/`
      matches track 10050 — expected: only `TU-10050-...`
- [ ] TC-3: `lc track-dir 10050` exits 0 and prints the survivor's path —
      expected: `conductor/tracks/TU-10050-worktree-base-freshness-...`
- [ ] TC-4: The reconciled `index.md` carries branch-sourced and DB-sourced
      fields together — expected: `Progress: 100%`, the real completed phase,
      `Track Kind: bug`, and `Merge Mode: direct` all present in one file
- [ ] TC-5: 10050's `plan.md`, `spec.md`, and `test.md` in the primary checkout
      match the branch's complete versions — expected: no stub `spec.md`
      remains
- [ ] TC-6: 10050's file marker and its database row agree on lane status —
      expected: both `done:queue`, neither `success`
- [ ] TC-7: After a full sync-worker cycle, the reconciled `index.md` is still
      reconciled — expected: the DB→FS pull does not revert it to `0% / New`
      (this is the phase's real pass condition, not TC-4 alone)

### Phase 2: Porting the worktree-base fix

- [ ] TC-8: Each of the three ported suites run against unported `main` fails —
      expected: failures, proving the suites exercise the fix rather than
      passing vacuously
- [ ] TC-9: `track-10050-worktree-start-point.test.mjs` after the port —
      expected: all cases pass
- [ ] TC-10: `track-10050-worktree-base-e2e.test.mjs` after the port —
      expected: all cases pass, including the case that rejects the naive
      "always use origin/main" fix (which would discard local-only commits)
- [ ] TC-11: `track-10050-lock-cli.test.mjs` after the port — expected: all
      cases pass
- [ ] TC-12: A genuinely new track's branch, created by the restarted worker in
      a real repository, is based on the resolved start point — expected: the
      branch's actual base commit is the freshest base that loses no local
      commits, read back with `git log`, not inferred from the diff
- [ ] TC-13: Creating a worktree for a track whose branch already exists and
      holds commits — expected: those commits survive, the branch is not reset
      (track 1114's data-loss regression)
- [ ] TC-14: Worktree creation with `origin` unreachable — expected: succeeds
      against the local default branch, logs the degradation, does not throw
- [ ] TC-15: Worktree creation with no `origin` remote configured at all —
      expected: succeeds, same degradation path
- [ ] TC-16: `conductor/lock.mjs` in a repository whose default branch is named
      something other than `main` — expected: resolves that branch, no
      `origin/main` reference
- [ ] TC-17: The resolved start point actually reaches the git command —
      expected: the command is rendered once from the resolved decision; a
      resolved start point other than `HEAD` is not silently replaced by `HEAD`
      (this is the second half of the bug and needs its own case)
- [ ] TC-18: `grep -rn "probeWorktreeStartPoint" conductor/` in the primary
      checkout — expected: finds the ported implementation and its call site

### Phase 3: Merge-mode fallback in the worktree audit

- [ ] TC-19: Branch has no `**Merge Mode**` marker, primary checkout has
      `direct` — expected: resolves `direct`
- [ ] TC-20: Branch has `**Merge Mode**: pr`, primary checkout has `direct` —
      expected: resolves `pr`, the branch still wins when it has an opinion
- [ ] TC-21: Neither branch nor primary checkout has a marker — expected:
      resolves `pr`, the documented default, unchanged
- [ ] TC-22: The primary checkout has no folder for the track at all —
      expected: resolves `pr`, no throw
- [ ] TC-23: The PR-fields fallback from `e84a27eb` still resolves PR number,
      URL, and status as before — expected: unchanged behaviour
- [ ] TC-24: The no-merge-base path still classifies discarded tracks
      correctly — expected: tracks 9997 and 10011 do not regress to `pr-open`
- [ ] TC-25: The forward-completion path from track 10067 still holds —
      expected: an already-merged `done:success` track is not reclassified as
      `open`
- [ ] TC-26: In the running Worktrees panel with a restarted API server, tracks
      10050, 10067, and 1119 — expected: all show `direct`, none offers
      "Run Merge Action" as the GitHub-PR flow

### Phase 4: Close-out

- [ ] TC-27: 10050's lane status after the port — expected: `done:success`, and
      truthful this time, with its code present in the primary checkout
- [ ] TC-28: `git branch --list track-10050` and `git worktree list` —
      expected: neither lists 10050
- [ ] TC-29: The Worktrees panel no longer lists 10050 — expected: absent, and
      no merge action offered for it anywhere

---

## Acceptance Criteria

- [ ] Every test case above passes, each verified by output actually observed
- [ ] The three ported 10050 suites failed before the port and pass after
- [ ] The two UI-observable outcomes (TC-26, TC-29) were confirmed by looking at
      the running panel, not by unit test alone
- [ ] Long-running processes (sync worker, API server) were restarted before any
      verification that depends on their code
- [ ] No orphaned worker or mock-collector processes remain after the test runs
- [ ] `node --test conductor/tests/` and `cd ui && npm test` show no regressions
