# Track AM-10096: Stop and clean up the self-replicating `.claude` nest

Root cause is confirmed and the fix primitive is validated — see `spec.md`.
Phases are ordered so growth stops before any cleanup runs; cleaning first would
be undone by the very next worktree creation.

## Phase 1: Extract the copy decision into a tested service

**Problem**: The rule for what goes from the repository's `.claude` into a
worktree's `.claude` is currently an inline shell string with no test coverage,
so its destination-exists trap was invisible.

**Solution**: A small module under `conductor/services/`, matching the pattern
`worktree-start-point.mjs` already set for safety-critical worktree decisions.

- [x] Create `conductor/services/claude-dir-copy.mjs`
    - [x] Export `shouldCopyClaudeEntry(relPath)` — a pure predicate over a path
          relative to the source `.claude` root. Returns false for any entry
          whose first segment is `.claude` (REQ-3, blocks propagating an
          existing nest), and false for `settings.local.json`,
          `scheduled_tasks.lock`, and `worktrees` (REQ-4, machine-local state).
    - [x] Export `copyClaudeDir(repoRoot, worktreePath)` — resolves source and
          destination, returns early when the source is absent, and copies with
          `fs.cpSync(src, dest, { recursive: true, filter })` where the filter
          delegates to the predicate.
    - [x] Comment the `cpSync`-over-`cp -r` choice at the call site, naming this
          track, so the shell form is not reintroduced.

**Impact**: The nesting rule becomes unit-testable in isolation, with no git and
no worktree required.

**Why `cpSync`**: verified empirically on Node v22.23.2 — three consecutive
`cpSync(src, dest, {recursive: true})` calls into an already-existing `dest`
leave depth at 1, whereas a single `cp -r` into the same destination produces
`dest/.claude`. `cpSync` also avoids the shell entirely, so paths containing
spaces or quotes stop being a latent hazard.

**Found during TDD, not in the original plan**: TC-15 caught a self-healing
gap the filter alone cannot close. When a repository's `.claude/.claude` is
itself **tracked in git** (main's current state, pending Phase 5), `git
worktree add` checks that nested content out into the destination directly,
before `copyClaudeDir` ever runs — the copy's filter only controls what our
own copy adds, it cannot un-write what git already materialized. `copyClaudeDir`
now also removes `<dest>/.claude/.claude` after copying, whichever mechanism
put it there. Covered by TC-15.

## Phase 2: Use the service in `createWorktree`

**Problem**: `conductor/laneconductor.sync.mjs:5005-5013` runs the defective
`cp -r`, once per worktree creation, for every project the worker serves.

**Solution**: Replace the block with a call to the Phase 1 helper.

- [x] Import `copyClaudeDir` in `conductor/laneconductor.sync.mjs`.
- [x] Replace the `claudeSrc`/`claudeDest`/`execSync` block with the call,
      keeping the existing warn-and-continue error handling — a failed `.claude`
      copy must never fail worktree creation.
- [x] Confirm by grep that `cp -r` has no remaining call site in `bin/`,
      `conductor/`, or `ui/server/`. It is currently the only one.

**Impact**: Growth stops at the source, for this repository and for every other
project the shared worker creates worktrees in.

## Phase 3: Make a nested `.claude` uncommittable

**Problem**: `.gitignore`'s `.claude/skills/*/` and `.claude/settings.local.json`
are root-anchored, so the nested copies escape every protection the top level
has. That is what turned a local mess into 480 files on `main`.

**Solution**: Ignore the nest itself at any depth. This is defense in depth
behind Phase 2, not a substitute for it.

- [ ] Add `**/.claude/.claude/` to `.gitignore` with a comment naming this track.
- [ ] Verify with `git check-ignore -v .claude/.claude/settings.json`.
- [ ] Note in the commit message that this does not untrack what is already
      tracked — Phase 5 does that.

**Impact**: Even if some future code path recreates a nest, no agent's
`git add -A` can land it on `main`.

## Phase 4: Guarded cleanup tool

**Problem**: Cleanup touches 40-plus worktrees and three repositories. Doing it
by hand invites deleting something that turns out to be unique, which is the
specific risk the track's problem statement calls out.

**Solution**: A script that audits first and only deletes what it has proven to
be duplicate.

- [ ] Create `conductor/scripts/clean-nested-claude.mjs`
    - [ ] Given a repository root, find every `.claude` nested under `.claude`.
    - [ ] For each nested level, diff it against level 1, ignoring the nested
          `.claude` entry. Collect files unique to the deeper level and files
          whose deeper copy is newer than level 1's.
    - [ ] Default to report-only. Print depth, file count, byte size, and any
          unique or newer file found.
    - [ ] With `--fix`, delete `.claude/.claude` only when the audit found
          nothing unique. With unique content present, refuse and exit non-zero
          naming the files (REQ-7).
    - [ ] With `--worktrees`, apply the same audit to each `.worktrees/*` entry.
    - [ ] Accept a repository path argument so it can be pointed at other
          projects.

**Impact**: Cleanup becomes repeatable and safe to run against unfamiliar
repositories, rather than a one-off `rm -rf` nobody can audit afterwards.

## Phase 5: Clean this repository's `main`

**Problem**: 480 tracked files, 6.4 MB, five levels deep on `main`. Deleting
from disk alone leaves them tracked; untracking alone leaves them on disk.

**Solution**: One commit that does both, after the audit passes.

- [ ] Run `clean-nested-claude.mjs` in report mode against the primary checkout
      and confirm it reports no unique content — matching this planning session's
      own finding that the only divergence is a strictly older `SKILL.md` at each
      depth.
- [ ] `git rm -r --cached .claude/.claude` and `rm -rf .claude/.claude`.
- [ ] Commit as `fix(track-10096): remove nested .claude tree from main`.
- [ ] Verify `git ls-files .claude` lists exactly `.claude/MEMORY.md`,
      `.claude/settings.json`, `.claude/skills/laneconductor/SKILL.md`.

**Impact**: `main` stops carrying the bloat, and subsequent track merges produce
readable diffs again.

## Phase 6: Clean the worktrees and the other affected projects

**Problem**: The nest lives in 40-plus existing worktrees at depths 3 to 6, and
in `livingwork` (4 levels) and `otralingo` (2 levels). Those worktrees sit on
branches whose tips still track the nest, so it returns to any of them on merge
until each is cleaned or rebased.

**Solution**: Run the Phase 4 tool across all of them.

- [ ] Run with `--worktrees --fix` against this repository.
- [ ] Run against `livingwork` and `otralingo`.
- [ ] Re-run the machine-wide sweep that found the problem and confirm every
      project with a `.laneconductor.json` reports a single `.claude` directory.
- [ ] Record in `conversation.md` which repositories were changed and what the
      audit reported for each.

**Impact**: The existing damage is gone everywhere it was found, not just on
`main`.

## Phase 7: Regression tests

**Problem**: This defect survived for the entire life of the repository — the
nest is present as far back as the initial commit — precisely because nothing
exercised the copy.

**Solution**: Cover the predicate in isolation and the real behaviour end to end.

- [ ] Create `conductor/tests/track-10096-claude-dir-nesting.test.mjs` per the
      cases enumerated in `test.md`.
- [ ] Include the end-to-end case that builds a temporary repository with its
      **own** `git init` and tracked `.claude/` files, then runs a real
      `git worktree add` plus the copy, and asserts depth 1.
- [ ] Run the existing worktree test files to confirm no regression:
      `track-1114-worktree-create-args`, `track-10050-worktree-start-point`,
      `worktree-create-path-resolution`, `track-1110-copy-worktree-artifacts`.

**Impact**: The trap cannot be reintroduced silently.
