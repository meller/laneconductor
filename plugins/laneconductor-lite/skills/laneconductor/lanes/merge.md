# merge lane (the `done` lane): `/laneconductor merge N`

The `done` lane's standard action (track 10035). It is claimed and run like the other lane actions
(Auto Run gate, parallel_limit, retries and per-lane model all apply), with one structural
difference: it runs in the **primary checkout, on `main`**, never in the track's worktree.
`done:success` means the code is reachable from local `main` (direct mode) or the PR is merged on
GitHub (pr mode), and nothing less.

Markers this lane reads and writes:
- `**Merge Mode**: direct|pr` (absent means `pr`). `direct` merges straight to main in this
  session; `pr` pushes the branch and opens a GitHub PR, landing at `done:waiting`. The file
  marker is authoritative over the DB's `merge_mode` column.
- `**PR URL**` (and `**PR Number**`, `**PR Status**`) are written by `lc worktrees create-pr` once
  `gh pr create` returns; the Kanban card and the Worktrees row show it while the track sits at
  `done:waiting`.

0. **Claim the track first.** Write `**Lane**: done` and `**Lane Status**: running` to
   `conductor/tracks/NNN-*/index.md`. Set `**Lane**` explicitly: when run directly the track may
   not sit in this lane, and the board would show it running in the wrong column.
1. **Work in the primary checkout.** Do not create a track worktree. Take the project's global
   main-mode lock (the one other `workspace: main` lane actions use) and work in the repo root the
   worker already runs from. Commits made here still name the track (`Merge track-NNN`, and so on).
2. **Load context.** On `FRESH_SESSION: false` skip files you already read this session, but always
   re-read `conversation.md`. Read `index.md` for `**Merge Mode**` and `conversation.md` for human
   instructions (for example a reconciler comment about a conflicted PR; see step 6).
3. **Single writer.** Only the primary checkout's copy of `conductor/tracks/NNN-*/*.md` is ever
   written (REQ-8). If a leftover worktree for the track still exists, do not touch its files:
   two copies of `index.md` written in two places is how markers get overwritten.
4. **Direct mode** (`**Merge Mode**: direct`):
   a. Run `lc worktrees merge NNN` (backed by `mergeWorktreeBranch()` in
      `conductor/services/worktree-merge.mjs`). It does the clean-merge path in one go: scratch
      worktree merge, auto-resolution of bookkeeping-only conflicts, compare-and-swap update of
      `main`, resync of the primary working tree, removal of the track's worktree and deletion of
      the local branch. It prints `✅ Merged track-NNN into main (<sha>)` and exits 0: go to 4e.
      If it reports `track-NNN branch not found`, that is expected, not a failure, for a track
      with `**Workspace**: main` (every earlier lane already ran on `main`, so there was never a
      branch). Treat it as a successful merge and go to 4e.
   b. If it exits non-zero with a **conflict** (stderr lists the paths; branch and worktree are
      left intact on purpose), this is a real conflict the primitive refused to guess at. Resolve
      it in this session: `git fetch origin`, then `git merge --no-ff track-NNN` in the primary
      checkout (you hold the main-mode lock, so this is safe). Read the conflicting hunks,
      understand both sides' intent (this track's plan/spec against the conflicting change on
      main) and produce a correct result. There is no separate conflict-resolution action.
   c. After a successful manual merge: `git push origin main`, then remove the worktree and branch
      by hand (`git worktree remove --force .worktrees/NNN`, `git branch -d track-NNN`,
      `git push origin --delete track-NNN`), which is the cleanup `lc worktrees merge` would have done.
   d. If a conflict cannot be resolved safely even in-session (semantic ambiguity, not just textual
      overlap), do not guess or force it. Set `**Lane Status**` to `lanes.done.on_failure`
      (`done:failure`) and write exactly what conflicts to `conversation.md`. Never fall back
      silently to `queue`.
   e. On any successful merge (4a or 4c) set `**Lane Status**: success` (`done:success`).
5. **PR mode** (`**Merge Mode**: pr`, or the marker is absent):
   a. Run `lc worktrees create-pr NNN` (backed by `createTrackPr()` in
      `conductor/services/pr-flow.mjs`). It pushes the branch, checks `gh auth status` first (it
      never falls back to a local merge when `gh` is not authenticated), runs `gh pr create` unless
      an open PR already exists for the branch (then it reports that one), and writes
      `**PR Number**`, `**PR URL**` and `**PR Status**` into the primary checkout's `index.md`.
   b. After a conflict re-run (step 6), the branch was already updated and pushed, so the existing
      PR picks up the new commits and `create-pr` only reports it.
   c. Set `**Lane Status**: waiting` (`done:waiting`). In the done lane, `waiting` means "waiting
      on a human outside the system": there is nothing more for this session to do. Do not merge
      the PR yourself; approval and merge happen on GitHub, and the reconciler observes that.
6. **Re-entry after a conflicted PR.** If the reconciler moved the track back to `done:queue`
   because it detected a PR conflict, run the pr-mode flow (step 5), but first `git fetch origin`
   and merge or rebase `origin/main` into `track-NNN`, resolve any real conflict in-session as in
   step 4b, and push (force-push if you rebased) before `lc worktrees create-pr NNN`. Pushing first
   is what makes the already-open-PR detection pick up the new commits.
7. **Post the completion comment**, authored `system`, emoji first:
   - direct success: `> **system**: ✅ Merged track-NNN to main.`
   - pr mode: `> **system**: ⚠️ PR opened - waiting for review: <url>.` (⚠️ because it needs human
     action, not because anything failed)
   - unresolved conflict: `> **system**: ❌ Merge conflict could not be resolved automatically - see details above.`

Boundary: this lane only merges or opens a PR for code that already passed review and
quality-gate. Write no feature code here; the only code changes it should make are those needed
to resolve a conflict between the track branch and `main`. `workflow.json` stays the authority
for target lanes.

## Skills that help here

These are suggestions, in the same spirit as the rest of this guide: a second opinion, never an order. If a skill
named here is installed (for example from the Superpowers plugin), consider using it; if it is not, say so in one line
and carry on without it. `finishing-a-development-branch` helps with the last steps (what to merge, what to clean up, what to leave to the human) without skipping the question about pushing.

Also read `conductor/workflow.json`. If it has a top-level `skills` object with a list under `"merge"`, such as
`{ "skills": { "merge": ["my-skill"] } }`, use those skills in addition, the same way: if one is installed, use it; if
it is missing, say so and continue. The `skills` key is optional; when it is absent, nothing changes. Where a skill's
own steps or file locations differ from this guide or from the track files, the track files and this guide win; take the
skill's method, not its output paths.
