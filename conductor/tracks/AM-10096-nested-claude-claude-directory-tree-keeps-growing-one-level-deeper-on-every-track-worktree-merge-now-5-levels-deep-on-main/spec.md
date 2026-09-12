# Spec: Stop the self-replicating `.claude/.claude/...` nest created on every worktree creation

## Problem Statement

The primary checkout carries a real, physically-materialized directory tree at
`.claude/.claude/.claude/.claude/.claude/` — five levels deep, 480 tracked files,
6.4 MB. It grows by exactly one level per track lifecycle, and the new level is
committed to `main` by whatever agent commit happens to run `git add -A` inside
the worktree. Track AM-10093's merge is a representative victim: 135 files
changed / 29,437 insertions, of which roughly 10 files and 600 lines were the
track's actual fix. The remaining ~28,800 lines were this nest riding along.

The problem is not confined to this repository. A sweep of every project on this
machine that carries a `.laneconductor.json` found the same nest in `livingwork`
(4 levels) and `otralingo` (2 levels), because the defect lives in the shared
sync worker that creates worktrees for all of them.

## Root Cause (confirmed, not inferred)

Single call site: `conductor/laneconductor.sync.mjs:5005-5013`, inside
`createWorktree()`.

```js
const claudeSrc = join(repoRoot, '.claude');
const claudeDest = join(worktreePath, '.claude');
if (existsSync(claudeSrc)) {
  execSync(`cp -r "${claudeSrc}" "${claudeDest}"`, { stdio: 'pipe' });
}
```

This is the classic `cp -r` destination-exists trap. `cp -r SRC DEST` copies
SRC's *contents* into DEST only when DEST does not exist. When DEST already
exists as a directory, `cp` copies SRC *itself* into it, producing
`DEST/.claude`. Verified directly in a scratch fixture: the same command
produced `wt/.claude/.claude/skills` against an existing destination and the
correct `wt2/.claude/skills` against a missing one.

The destination always exists here. This repository tracks files under
`.claude/` (`.claude/MEMORY.md`, `.claude/settings.json`,
`.claude/skills/laneconductor/SKILL.md` — the last two deliberately, since this
repo is the skill's own home). `git worktree add` therefore checks `.claude/`
out before the copy ever runs. Every worktree creation is guaranteed to hit the
nesting branch.

### The full causal chain

1. `git worktree add` materializes the tracked `.claude/` files, so
   `<worktree>/.claude` exists.
2. `cp -r <repo>/.claude <worktree>/.claude` copies the repo's entire `.claude`
   tree — *including the levels it already contains* — to
   `<worktree>/.claude/.claude`. Depth goes from D to D+1.
3. `.gitignore`'s protections are root-anchored and do not reach the nested
   path. `.claude/skills/*/` with `!.claude/skills/laneconductor/` keeps 32
   third-party marketing and dev skills out of git at the top level; at
   `.claude/.claude/skills/*/` those same skills are not ignored at all. This is
   exactly why 480 files are tracked in the nest while only 3 are tracked at the
   top level.
4. An agent commit inside the worktree during implement, review, or
   quality-gate sweeps the new untracked tree in. Confirmed in history: the
   commits that touch `.claude/.claude` are ordinary lane-action commits
   (`fix(track-10052)`, `review(track-10046)`, `chore(track-10093)`, …), never a
   dedicated one. The pre-worktree sync commit at
   `laneconductor.sync.mjs:4818-4826` is correctly scoped to the track folder
   and is **not** the vector.
5. The merge lands the new level on `main`. The next track's worktree starts one
   level deeper, and the cycle repeats.

The on-disk timestamps confirm the timeline: each level's own files carry a
distinct, monotonically increasing mtime (Sep 3, Sep 4, Sep 9, Sep 12) because
git only rewrites the newly added deepest level; the identical levels above it
are left untouched.

## Is any nested content unique?

No. This was checked rather than assumed, per the track's own instruction not to
delete unfamiliar nested state blindly.

`diff -rq` of level 1 against each of levels 2 through 5 (excluding the nested
`.claude` entry itself) reports **no unique file at any depth**. The only
reported differences are:

- Files present at level 1 and absent deeper: `settings.local.json`,
  `scheduled_tasks.lock`, `worktrees/`. These are local-only and correctly
  never copied onward.
- `skills/laneconductor/SKILL.md` differs by depth, and every deeper copy is
  strictly **older**: level 1 and 2 are byte-identical (2,321 lines), level 3 is
  a 2,280-line snapshot, levels 4 and 5 a 2,271-line one. Each nested copy is a
  frozen snapshot of the skill as it stood when that level was created.

Deleting the nest therefore loses nothing. It removes stale duplicates only.

## Requirements

- **REQ-1**: `createWorktree()` must copy the repository's `.claude` *contents*
  into the worktree's `.claude`, never the directory itself, regardless of
  whether the destination already exists.
- **REQ-2**: The copy must be idempotent. Running it N times against the same
  worktree must leave exactly one real `.claude` directory, at depth 1.
- **REQ-3**: The copy must not propagate a nested `.claude` even when the source
  is already corrupted, so the fix is self-healing for every repository that
  already carries a nest rather than requiring cleanup to land first.
- **REQ-4**: The copy must not carry machine-local state into a worktree —
  `settings.local.json`, `scheduled_tasks.lock`, and `worktrees/` stay behind,
  matching what the current nest already shows to be the de-facto behaviour.
- **REQ-5**: The decision of what to copy must live in its own module under
  `conductor/services/` with isolated unit tests, following the pattern this
  file already established for `resolveWorktreeAddArgs`
  (`conductor/services/worktree-start-point.mjs`).
- **REQ-6**: `.gitignore` must make a nested `.claude` uncommittable at any
  depth, so a future regression cannot reach `main` even if some other code path
  creates one. A `.gitignore` rule alone does not untrack what is already
  tracked, so this is defense in depth, not the fix.
- **REQ-7**: Cleanup must be guarded, not blind. Before deleting a nest, the
  tooling must diff every nested level against level 1 and refuse to delete if
  any file is unique to a deeper level, printing what it found.
- **REQ-8**: Cleanup must cover this repository's `main`, the 40-plus existing
  worktrees, and the other affected projects on this machine (`livingwork`,
  `otralingo`).
- **REQ-9**: Removing the nest from `main` must untrack the 480 files
  (`git rm -r --cached`) as well as delete them from disk, in one commit.

## Acceptance Criteria

- [ ] Creating a worktree for a track in a repository that tracks files under
      `.claude/` leaves exactly one `.claude` directory in that worktree, with
      `.claude/skills/laneconductor/SKILL.md` present and matching the primary
      checkout's copy.
- [ ] Creating a worktree in a repository whose `.claude` is *already* nested
      produces a worktree with a single, un-nested `.claude`.
- [ ] Creating and re-creating a worktree three times in a row does not increase
      the nesting depth beyond 1.
- [ ] `git check-ignore .claude/.claude/anything` reports the path as ignored in
      this repository.
- [ ] `find .claude -name .claude -type d` in the primary checkout returns
      nothing, and `git ls-files .claude` lists only the three intended files.
- [ ] The cleanup tool, run against a fixture where a deeper level holds a file
      that exists nowhere else, refuses to delete and names that file.
- [ ] `livingwork` and `otralingo` each report a single `.claude` directory after
      remediation.
- [ ] A merge of a subsequent track branch into `main` shows a diff containing
      only that track's own files — no `.claude/.claude` paths.

## Non-Goals

- Changing whether this repository tracks `.claude/skills/laneconductor/` at all.
  It is tracked deliberately, because this repo is the skill's canonical home.
- Rewriting git history to purge the nest from past commits. The 6.4 MB is
  already in the object database; removing it going forward is enough, and a
  history rewrite would invalidate every open worktree and branch on this
  machine.
- Replacing the copy with a symlink. The track's problem statement raised
  symlinking as a hypothesis, but the installation symlink described in
  `SKILL.md` applies to *consumer* projects linking back to the canonical
  install path. Inside this repo the skill is a real tracked file, and a
  worktree needs a real copy so an agent running there sees the branch's own
  state. The defect is the copy's semantics, not the choice to copy.
- Preventing agents from running `git add -A` inside worktrees. That behaviour
  is the delivery vector, not the source; with REQ-1 and REQ-6 in place there is
  nothing for it to sweep in.
