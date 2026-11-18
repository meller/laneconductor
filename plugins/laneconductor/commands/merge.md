---
description: Merge a finished track, or open its PR
argument-hint: <track number or title>
---
Work on track `$ARGUMENTS` in the merge lane. The procedure is the merge lane guide (skill file `lanes/merge.md`); follow it and do not restate it here.

This command carries the skill text it uses, at the end under "Reference". Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the command are references only.

1. Find the track's folder under `conductor/tracks/` (Glob `conductor/tracks/*<number>*/`; both naming conventions exist, see "Finding a track" in the skill index) and read its `index.md`, `spec.md`, `plan.md`, `test.md` and `conversation.md`. Read the lane guide too. Read where a lane sends a finished track from `conductor/workflow.json` with the grammar of the skill file `ops/lanes-and-statuses.md` (a bare target is `queue` for another lane and `success` or `failure` for the same lane; a bare `done` is `done:queue`); never guess it from the raw file. The guide is advice.
2. Work through the guide. Change state by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.
3. Ask me before any merge or push; do neither without my yes.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__get_context`, `mcp__plugin_laneconductor-parallel_lc__get_track`, `mcp__plugin_laneconductor-parallel_lc__list_tracks`, `mcp__plugin_laneconductor-parallel_lc__update_track`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.

## Reference

From the skill files this command names, copied here: whole files, or only the sections the command uses.

### `lanes/merge.md`

The `done` lane's standard action. It runs in the **primary checkout, on `main`**, never in the track's worktree.
`done:success` means the code is reachable from local `main` (direct mode) or the PR is merged on
GitHub (pr mode), and nothing less.

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
`ops/lanes-and-statuses.md`).

#### Skills that help here

These are suggestions, in the same spirit as the rest of this guide: a second opinion, never an order. If a skill
named here is installed (for example from the Superpowers plugin), consider using it; if it is not, say so in one line
and carry on without it. `finishing-a-development-branch` helps with the last steps (what to merge, what to clean up, what to leave to the human) without skipping the question about pushing.

Also read `conductor/workflow.json`. If it has a top-level `skills` object with a list under `"merge"`, such as
`{ "skills": { "merge": ["my-skill"] } }`, use those skills in addition, the same way: if one is installed, use it; if
it is missing, say so and continue. The `skills` key is optional; when it is absent, nothing changes. Where a skill's
own steps or file locations differ from this guide or from the track files, the track files and this guide win; take the
skill's method, not its output paths.

### `ops/lanes-and-statuses.md` (The five lane statuses; Transitions; Lane names; Manual moves win)

#### The five lane statuses

| Status | Meaning |
|--------|---------|
| `queue` | Waiting for the lane's action to start (or to be picked up). A track that just moved into a lane is `queue`. |
| `running` | An agent is executing this lane's action **right now**. |
| `success` | The lane's action finished well, and the track rests here (for example `plan:success`: the plan is written and parked). |
| `failure` | The lane's action failed or could not finish; a person or a retry decides next. |
| `waiting` | Parked on purpose until a human (or a named track) acts: a question, an approval, a dependency. |

**`running` belongs to the lane whose action is executing.** It is never used for work that belongs to another lane. A deploy
gate (the full suites, then the deploy) is `quality-gate:running`, not `implement:running` and not `in-progress:running`.

#### Transitions

Each lane in `conductor/workflow.json` may carry `on_success` and `on_failure`. A target is one of:

| Written | Means |
|---------|-------|
| `lane:status`, for example `review:queue`, `plan:success`, `implement:failure` | exactly that lane and status |
| `lane` alone, naming a **different** lane (`review`) | that lane with status `queue` |
| `lane` alone, naming the **same** lane the action ran in | `success` for `on_success`, `failure` for `on_failure` |
| a bare `done` from another lane | `done:queue`, never `done:success` |
| `null` | no automatic move: the lane's own action or a human decides |
| missing from the lane | the file's top-level `defaults.on_success` / `defaults.on_failure`, read the same way; no automatic move when the file has none (an explicit `null` never falls back) |
| `stay` or `stop` | no automatic move. Older files carry these words; they are read, never written, so do not put them in a file |

An unknown current lane is an error; do not guess. Names are compared ignoring case and spaces. These fields are leftovers of the older format and
are ignored: `auto_action`, `parallel_limit`, `max_retries`, `global`, `primary_model`, `hooks`.

Worked examples. This project's own file (current format):

| Lane | on_success | on_failure |
|------|-----------|-----------|
| plan | `plan:success` (stays, parked) | `backlog:queue` |
| implement | `review:queue` | `implement:failure` |
| review | `quality-gate:queue` | `implement:queue` |
| quality-gate | `done:queue` | `plan:queue` |
| done | none | `done:failure` |

An older file (the older format: bare targets, old lane names): `in-progress` with `"on_success": "review"` and `"on_failure": "in-progress"`
resolves to `review:queue` on success and `in-progress:failure` on failure (the failure target names the same lane); `planning` with
`"on_success": "backlog"` resolves to `backlog:queue`; `done` and `backlog` with `null` targets have no automatic move.

#### Lane names

A project names its own lanes in `conductor/workflow.json`; the guides and commands use the standard names. The standard names replaced the old ones:
`planning` to `plan` and `in-progress` to `implement`; older projects (and the older-format files they carry) keep the old names, and existing tracks
are never renamed. The lane guides stand for the project's lane that means the same thing: `plan` is `planning`, `implement` is `in-progress`.
The connector reports this mapping as `valid.guide_lanes` (and the project's lane names as `valid.lanes`); without it, match by meaning. Write
the project's own names into `**Lane**`.

#### Manual moves win

A human's move of a card always wins. Before writing any transition, re-read `**Lane**` in `index.md`; if it is no longer the lane you worked
in, leave `**Lane**` and `**Lane Status**` alone and say so in the completion comment. If you deliberately skip a lane (for example the
deploy gate stands in for review), note the skip in `conversation.md`; following the workflow strictly means taking `on_success`.

### `ops/tracks.md` (move; pulse; comment)

#### move `[track-number] [lane:status]`

Moving to a lane without a status means `queue`: `move NNN backlog`, `move NNN implement:queue`
(it waits in that lane), `move NNN plan:success` (parked as done planning). Set `**Lane**` and
`**Lane Status**` in `conductor/tracks/NNN-*/index.md` (with the add-on, `update_track` with those markers).
Prefer a `lane:status` that `workflow.json` defines for that lane. When the move is "this lane's action
finished", do not work the target out yourself: with the connector, call `update_track` with `outcome`
(`success` or `failure`) and the `base` from `get_track`, which applies the workflow's move; its answer to
"where does it go" is `valid.next` in `get_track`. Without the connector, read `workflow.json` with the
grammar in `ops/lanes-and-statuses.md` (a bare target is `queue` for another lane;
for the same lane it is `success` or `failure`).

#### pulse `[track-number] [status] [progress%] [summary?]`

Update the track's markers in `conductor/tracks/NNN-*/index.md`: `**Progress**: N%`, `**Phase**`
when the work entered a new phase, `**Step**` (the current activity; infer it if not given),
`**Summary**`, and `**Waiting for reply**: no` after every AI response. A `[status]` that names a lane is a move, so use `move` for that;
`pulse` does not write `**Status**` any more (it is a legacy marker the parser only reads when
`**Lane**` is missing).

#### comment `[track-number] [body]`

A comment from a person or an agent is a `> **author**: [body]` entry (format rules in SKILL.md) in
`conductor/tracks/NNN-*/conversation.md`; this is also how an agent answers a human comment. A note that records
an event (a run, a classification, a completion) is a dated line in `history.md` instead (see "What goes in each track file").
Use `⚠️` for something that needs a human and `ℹ️` for a note.

### `SKILL.md` (Finding a track; conversation.md format)

#### Finding a track

A track number maps to one folder under `conductor/tracks/`. With the parallel add-on, `get_track` finds it. Without
it, use Glob `conductor/tracks/*-<N>-*/` for the form `INITIALS-NNN-slug` (for example `AM-10023-my-feature`, the
current form) **and** `conductor/tracks/<N>-*/` for the older bare `NNN-slug`; scan for **both** (a scan for one
form silently misses every folder of the other). If neither finds it, `conductor/tracks-summary.md` (when it exists) lists the tracks.

If any folder exists for the number, use it. Scaffolding a second one is an error, not a
fallback: a scan that missed `AM-<number>-...` once created a duplicate `<number>-...` folder.

#### conversation.md format

`conversation.md` holds the dialogue. An entry that records an event (a lane completion, a classification) is a dated line
in `history.md` instead; with the connector, `append_conversation` with author `system` writes that line there. Every
entry in `conductor/tracks/NNN-*/conversation.md`, from an agent or a human, must look like:
```
> **author**: First line of the message
> second line, also prefixed with >
```
`author` is `human`, `claude`, `gemini` or `system`. The tools that read it recognize only
`> **author**: ...` lines plus `>`-prefixed continuations. Anything else (a markdown header, a plain
blockquote, loose prose) stays in the file but is silently never synced to the UI, with no error.
For long pasted material (an email, a contract, a redline) keep one opening `> **author**:` line and
prefix every following line, blank ones and markdown headers included, with `>`. Do not drop the
prefix partway because the content reads like a document.
