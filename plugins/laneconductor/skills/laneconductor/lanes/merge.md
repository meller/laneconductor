# merge lane (the `done` lane): `/laneconductor merge N`

The `done` lane's standard action. It runs in the **primary checkout, on `main`**, never in the track's worktree.
`done:success` means the code is reachable from local `main` (direct mode) or the PR is merged on
GitHub (pr mode), and nothing less.

Before step 1, look at "Offer a missing skill" near the end of this guide: one check, usually silent.

Markers this lane reads and writes:
- `**Merge Mode**: direct|pr` (absent means `pr`). `direct` merges straight to main in this
  session; `pr` pushes the branch and opens a GitHub PR, landing at `done:waiting`.
- `**PR URL**` (and `**PR Number**`, `**PR Status**`) are written by this lane once `gh pr create`
  returns; the board shows the URL while the track sits at `done:waiting`.

0. **Claim the track first.** Write `**Lane**: done` and `**Lane Status**: running` to
   `conductor/tracks/NNN-*/index.md`. Set `**Lane**` explicitly: when run directly the track may
   not sit in this lane, and the board would show it running in the wrong column.
1. **Work in the primary checkout.** Do not create a track worktree; work in the repo root, with `main`
   checked out. Commits made here still name the track (`Merge track-NNN`, and so on).
2. **Load context.** Skip files you already read this session, but always re-read `conversation.md`.
   Read `index.md` for `**Merge Mode**` and `conversation.md` for human instructions (for example
   a note about a conflicted PR; see step 6).
3. **Single writer.** Only the primary checkout's copy of `conductor/tracks/NNN-*/*.md` is ever
   written. If a leftover worktree for the track still exists, do not touch its files:
   two copies of `index.md` written in two places is how markers get overwritten.
4. **Direct mode** (`**Merge Mode**: direct`):
   a. Check `git status` in the primary checkout is clean enough to merge, then
      `git merge --no-ff track-NNN` with a message that names the track (`Merge track-NNN`). If it reports
      `track-NNN` is not a branch, that is expected, not a failure, for a track with
      `**Workspace**: main` (every earlier lane already ran on `main`, so there was never a
      branch). Treat it as a successful merge and go to 4e.
   b. If the merge stops with a **conflict**, resolve it in this session: read the conflicting
      hunks, understand both sides' intent (this track's plan/spec against the conflicting change
      on main) and produce a correct result, then commit the merge. There is no separate
      conflict-resolution action.
   c. After a successful merge, remove the worktree and the branch by hand
      (`git worktree remove --force .worktrees/NNN`, `git branch -d track-NNN`). Ask the human
      before any push (`git push origin main`, `git push origin --delete track-NNN`); say what
      would be pushed, and push nothing without a yes.
   d. If a conflict cannot be resolved safely even in-session (semantic ambiguity, not just textual
      overlap), do not guess or force it: run `git merge --abort`, set `**Lane Status**` to
      `lanes.done.on_failure` (`done:failure`) and write exactly what conflicts to `conversation.md`.
      Never fall back silently to `queue`.
   e. On any successful merge (4a or 4b) set `**Lane Status**: success` (`done:success`).
5. **PR mode** (`**Merge Mode**: pr`, or the marker is absent):
   a. Check `gh auth status` first; never fall back to a local merge when `gh` is not authenticated.
      If an open PR already exists for the branch (`gh pr list --head track-NNN`), report that one
      instead of opening a second. Otherwise, after the human says yes, `git push -u origin track-NNN`
      and then `gh pr create` (title naming the track, body from the track's summary), and write
      `**PR Number**`, `**PR URL**` and `**PR Status**` into the primary checkout's `index.md`.
   b. After a conflict re-run (step 6), the branch was already updated and pushed, so the existing
      PR picks up the new commits; just report it.
   c. Set `**Lane Status**: waiting` (`done:waiting`). In the done lane, `waiting` means "waiting
      on a human outside the system": there is nothing more for this session to do. Do not merge
      the PR yourself; approval and merge happen on GitHub.
6. **Re-entry after a conflicted PR.** If the track was moved back to `done:queue` because GitHub
   reports the PR has a conflict, run the pr-mode flow (step 5), but first `git fetch origin`
   and merge or rebase `origin/main` into `track-NNN`, resolve any real conflict in-session as in
   step 4b, and push (force-push only after a yes, and only if you rebased) before looking for
   the open PR. Pushing first is what makes the existing PR pick up the new commits.
7. **Add the completion line** to `history.md` (`- <YYYY-MM-DD HH:MMZ> <emoji> <text>`, emoji first; the merge, the
   commit hashes and any incident are dated lines there, never in `plan.md` or `spec.md`):
   - direct success: `✅ Merged track-NNN to main.`
   - pr mode: `⚠️ PR opened - waiting for review: <url>.` (⚠️ because it needs human
     action, not because anything failed)
   - unresolved conflict: `❌ Merge conflict could not be resolved automatically - see details above.`

Boundary: this lane only merges or opens a PR for code that already passed review and
quality-gate. Write no feature code here; the only code changes it should make are those needed
to resolve a conflict between the track branch and `main`. `workflow.json` stays the authority
for target lanes (how a target is read, and `done:queue` against `done:success`, is in
[../ops/lanes-and-statuses.md](../ops/lanes-and-statuses.md)).

## Offer a missing skill

Before the work, look at what fits this lane and offer what is missing; `/laneconductor:suggest-skills` is the whole procedure. Usually this is silent: nothing missing means no message, and an offer never blocks the work.

The track is the one this command names, so its lane, `**Type**` and stack are known. At the start of this lane, and again when the track's situation changes (a failing test, a review comment to answer, a UI, a deploy), look at what fits and offer what is missing. Usually this is silent. The full command is `/laneconductor:suggest-skills`.

**How to offer.** Plain text in your reply: never a form, a menu or a question that blocks the work.

1. **Look first.** A skill counts as installed when any of these is true: it is in the skills list this session shows you (that list already covers project, user and plugin skills, and a plugin skill can appear as `plugin:skill`); `claude plugin list` (read only; run it once per session, and only when the list is not enough) shows its plugin as enabled; or a folder with its name exists in `.claude/skills/` of the project or in `~/.claude/skills/`. A skill listed under an older name counts too. When it is installed, say so in one line ("you have `<skill>` installed, use it before writing the content") and use it.
2. **Offer only what is missing**, from the candidates below that fit the lane, the track's `**Type**` (`dev` when it has none) and the project's stack: read `conductor/tech-stack.md` and look for the marker files named under "Stack tags". When nothing is missing, say nothing.
3. **Be quiet.** At most two items per offer: our own entries before third-party ones, `prerequisite` before `helps`. Never the same entry twice in a session, and never an entry on the project's declined list: the file `skill-advisor-declined.txt` inside the directory that `git rev-parse --git-common-dir` prints (one entry name per line; it is inside `.git`, so it is never committed). A trivial track gets at most the one-line tip, and a suggestion in the middle of a step (a failing test and `systematic-debugging`) is one line.
4. **Say it in one or two plain sentences**: what it is, why it helps here, where it comes from, and what it installs (use the note under its name: an entry that installs a program says so plainly; a Markdown-only one adds knowledge only). Then each install command alone in its own bash block, one command per block, no leading `$`, so the desktop app shows a Run button. In a session the person can type `/plugin install <plugin>@<marketplace>` instead (inline text, not a block); that opens the plugin's details for review.
5. **Level.** `prerequisite`: say the result will be better with it and ask, in the same sentence, whether to install it first or carry on. `helps`: a one-line tip. Either way the work is not blocked: with no answer, carry on.
6. **The answer.** *Install first*: show the commands, say nothing has been changed yet, say to run them and then `/reload-plugins`, and when the person is back start the step again from the top with the skill present. *Carry on*: start the step at once and do not repeat the offer this session. *Do not ask again*: show the line you would add and, after the yes, append the entry's name to the declined file; with no git directory, just do not offer it again this session.
7. **Never run an install yourself.** The commands are shown; the person runs them, or uses the client's own plugin browser. If one fails, report the command and its output, retry nothing silently and work around nothing by editing settings or permissions. To share a plugin with collaborators, offer to add it to `enabledPlugins` in the project's `.claude/settings.json` only when the person asks: show the exact change first, say it turns the plugin on for them but does not download it (each person runs the install once with `--scope project`), and write it only after a yes.

Candidates for the `merge` lane:

#### `superpowers`

Process skills for the lanes: brainstorming and writing plans, test-first work, systematic debugging, sub-agent execution, worktrees, code review and verification before done. Third-party, licence MIT, from `anthropics/claude-plugins-official`. Fits `setup`, `brainstorm`, `plan`, `implement`, `review`, `quality-gate`, `merge` (lanes), Type `dev`, any stack. Level: `helps`.
Skills for this part: `finishing-a-development-branch`.
It counts as installed when one of its skills (for example `test-driven-development`) is in the session's skills list, or `claude plugin list` shows `superpowers@claude-plugins-official`. It installs a shell hook script that runs when each session starts, plus Markdown skills on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install superpowers@claude-plugins-official
```

## Skills that help here

These are suggestions, in the same spirit as the rest of this guide: a second opinion, never an order. If a skill
named here is installed (for example from the Superpowers plugin), consider using it; if it is not, say so in one line
and carry on without it. `finishing-a-development-branch` helps with the last steps (what to merge, what to clean up, what to leave to the human) without skipping the question about pushing.

Also read `conductor/workflow.json`. If it has a top-level `skills` object with a list under `"merge"`, such as
`{ "skills": { "merge": ["my-skill"] } }`, use those skills in addition, the same way: if one is installed, use it; if
it is missing, say so and continue. The `skills` key is optional; when it is absent, nothing changes. Where a skill's
own steps or file locations differ from this guide or from the track files, the track files and this guide win; take the
skill's method, not its output paths.
