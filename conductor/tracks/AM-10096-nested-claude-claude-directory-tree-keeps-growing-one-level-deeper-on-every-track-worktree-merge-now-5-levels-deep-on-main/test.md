# Tests: Track AM-10096 — `.claude` nesting on worktree creation

## Test Commands

```bash
# This track's own suite
node --test conductor/tests/track-10096-claude-dir-nesting.test.mjs

# Worktree regression set (must stay green)
node --test conductor/tests/track-1114-worktree-create-args.test.mjs \
            conductor/tests/track-10050-worktree-start-point.test.mjs \
            conductor/tests/worktree-create-path-resolution.test.mjs \
            conductor/tests/track-1110-copy-worktree-artifacts.test.mjs

# Mocked unit/integration suite
cd ui && npx vitest run
```

### Test hygiene — read before running

Two hazards are already documented for this repository and both apply here.

- **Worktree redirect**: a worker-spawning test whose temporary fixture has no
  `git init` of its own, run from inside a track worktree, is silently
  redirected to register against the real primary checkout. Every fixture in
  this track's suite must `git init` its own repository. A run where the
  end-to-end case times out on worktree creation is this, not a real
  regression — grep the log for `which is not the primary checkout`.
- **Leaked workers**: both `node --test` and `cd ui && npx vitest run` have left
  real `laneconductor.sync.mjs` processes running against the primary checkout.
  After every full run, check `ps aux | grep laneconductor.sync.mjs` and
  `readlink /proc/<pid>/cwd` before concluding anything about leaks — one worker
  per project is expected, duplicates against the same cwd are not.

## Test Cases

### Feature: `shouldCopyClaudeEntry` predicate (Phase 1, unit)

- [ ] TC-1: `shouldCopyClaudeEntry('skills/laneconductor/SKILL.md')` — expected:
      `true`, the skill is exactly what the worktree needs.
- [ ] TC-2: `shouldCopyClaudeEntry('MEMORY.md')` — expected: `true`.
- [ ] TC-3: `shouldCopyClaudeEntry('.claude')` — expected: `false`, this is the
      guard that stops an already-corrupted source propagating (REQ-3).
- [ ] TC-4: `shouldCopyClaudeEntry('.claude/skills/social-content/SKILL.md')` —
      expected: `false`, anything beneath a nested `.claude` is excluded too.
- [ ] TC-5: `shouldCopyClaudeEntry('settings.local.json')` — expected: `false`,
      machine-local (REQ-4).
- [ ] TC-6: `shouldCopyClaudeEntry('scheduled_tasks.lock')` and
      `shouldCopyClaudeEntry('worktrees')` — expected: `false` for both.
- [ ] TC-7: `shouldCopyClaudeEntry('skills/my-settings.local.json')` — expected:
      `true`, the exclusions are anchored at the `.claude` root and must not
      match a same-named file nested deeper.

### Feature: `copyClaudeDir` behaviour (Phase 1, filesystem, no git)

- [ ] TC-8: destination does not exist — expected: `dest/.claude/skills/...`
      exists and `dest/.claude/.claude` does not.
- [ ] TC-9: destination already exists as a directory (the real-world case, since
      `git worktree add` checks tracked `.claude/` files out first) — expected:
      still exactly one `.claude`, no `dest/.claude/.claude` (REQ-1). This case
      fails against the current `cp -r` implementation and is the primary
      regression guard.
- [ ] TC-10: called three times in a row against the same destination — expected:
      `find dest -name .claude -type d` returns exactly one path (REQ-2).
- [ ] TC-11: source is already nested five levels deep — expected: destination
      has exactly one `.claude`, and the stale nested content is absent (REQ-3).
      This is what makes the fix self-healing ahead of cleanup.
- [ ] TC-12: source contains `settings.local.json`, `scheduled_tasks.lock` and
      `worktrees/` — expected: none of the three appear in the destination
      (REQ-4).
- [ ] TC-13: source `.claude` does not exist at all — expected: returns without
      throwing and creates nothing.

### Feature: real worktree creation (Phase 2, end-to-end)

- [ ] TC-14: in a temporary repository created with its own `git init`, with
      `.claude/MEMORY.md` and `.claude/skills/laneconductor/SKILL.md` committed,
      run a real `git worktree add` followed by `copyClaudeDir` — expected:
      exactly one `.claude` in the worktree, `SKILL.md` present, byte-identical
      to the source.
- [ ] TC-15: same fixture, but the committed `.claude` already contains a nested
      `.claude/.claude` — expected: the worktree gets a single, clean `.claude`,
      demonstrating the end-to-end self-healing path.
- [ ] TC-16: create, remove, and re-create the worktree for the same track —
      expected: depth stays 1 across all three cycles.

### Feature: gitignore protection (Phase 3)

- [ ] TC-17: `git check-ignore -v .claude/.claude/settings.json` in this
      repository — expected: exits 0 and names the `**/.claude/.claude/` rule.
- [ ] TC-18: `git check-ignore .claude/skills/laneconductor/SKILL.md` — expected:
      exits non-zero, the canonical skill stays tracked and the new rule has not
      over-reached.
- [ ] TC-19: in a scratch fixture, create `.claude/.claude/skills/x/SKILL.md`,
      run `git add -A`, then `git status --porcelain` — expected: nothing under
      `.claude/.claude` is staged. This reproduces the exact delivery vector
      (an agent's blanket `git add -A` inside a worktree).

### Feature: guarded cleanup tool (Phase 4)

- [ ] TC-20: fixture whose nested levels are pure duplicates, run in report mode
      — expected: reports the depth and file count, reports no unique content,
      and deletes nothing.
- [ ] TC-21: same fixture with `--fix` — expected: `.claude/.claude` is gone,
      level 1 is untouched, exit 0.
- [ ] TC-22: fixture where level 3 holds `unique-note.md` that exists at no other
      level, run with `--fix` — expected: exits non-zero, deletes nothing, and
      prints the path of `unique-note.md` (REQ-7). This is the guard that makes
      the tool safe to point at an unfamiliar repository.
- [ ] TC-23: fixture where a nested `SKILL.md` is *newer* than level 1's —
      expected: flagged in the report as newer, since a newer deeper copy could
      indicate real work landed in the wrong place.
- [ ] TC-24: repository with no nest at all — expected: exits 0, reports nothing
      to do, changes nothing.

## Manual Verification (Phases 5 and 6)

Unit tests cannot show that the live repositories were actually repaired.

- [ ] MV-1: `find .claude -name .claude -type d` in the primary checkout returns
      nothing.
- [ ] MV-2: `git ls-files .claude` in the primary checkout lists exactly
      `.claude/MEMORY.md`, `.claude/settings.json`, and
      `.claude/skills/laneconductor/SKILL.md`.
- [ ] MV-3: `du -sh .claude` shows the ~6.4 MB nest gone.
- [ ] MV-4: the machine-wide sweep across every project holding a
      `.laneconductor.json` reports depth 1 everywhere, including `livingwork`
      and `otralingo`.
- [ ] MV-5: restart the sync worker (it does not hot-reload — a worker started
      before the change still runs the old `cp -r`), let it create a worktree for
      a real track, and confirm that worktree has a single `.claude`.
- [ ] MV-6: the diff of the next track branch merged into `main` contains no
      `.claude/.claude` path, and its file count is proportionate to the work.

## Acceptance Criteria

- [ ] All test cases above pass.
- [ ] TC-9 fails against the pre-fix implementation and passes after — confirming
      the test actually exercises the defect rather than restating the fix.
- [ ] The worktree regression set stays green.
- [ ] No orphaned `laneconductor.sync.mjs` process is left behind by the test run.
