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

A non-dev track (`**Type**` not `dev`) has no branch and nothing to merge: if one sits at `done:queue`, set `done:success`, say so and stop.

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
   two copies of `index.md` is how markers get overwritten.
4. **Direct mode** (`**Merge Mode**: direct`):
   a. Check `git status` in the primary checkout is clean enough to merge, then
      `git merge --no-ff track-NNN` with a message that names the track (`Merge track-NNN`). If it reports
      `track-NNN` is not a branch, that is expected, not a failure, for a track with
      `**Workspace**: main` (every lane ran on `main`, so there was never a branch). Treat it as a successful merge and go to 4e.
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
   c. Set `**Lane Status**: waiting` (`done:waiting`): waiting on a human outside the system, nothing
      more for this session to do. Do not merge the PR yourself; approval and merge happen on GitHub.
6. **Re-entry after a conflicted PR.** If the track was moved back to `done:queue` because GitHub
   reports the PR has a conflict, run the pr-mode flow (step 5), but first `git fetch origin`
   and merge or rebase `origin/main` into `track-NNN`, resolve any real conflict in-session as in
   step 4b, and push (force-push only after a yes, and only if you rebased) before looking for
   the open PR, so the existing PR picks up the new commits.
7. **Add the completion line** to `history.md` (`- <YYYY-MM-DD HH:MMZ> <emoji> <text>`, emoji first; the merge, hashes and
   incidents are dated lines there, never in `plan.md` or `spec.md`):
   - direct success: `✅ Merged track-NNN to main.`
   - pr mode: `⚠️ PR opened - waiting for review: <url>.` (⚠️ because it needs human
     action, not because anything failed)
   - unresolved conflict: `❌ Merge conflict could not be resolved automatically - see details above.`
8. **Close** with the closing message of a lane.

Boundary: this lane only merges or opens a PR for code that already passed review and
quality-gate. Write no feature code here; change code only to resolve a conflict with `main`. `workflow.json` stays the authority
for target lanes (how a target is read, and `done:queue` against `done:success`, is in
`ops/lanes-and-statuses.md`).

#### Offer a missing skill

Before the work, look at what fits this lane and offer what is missing; usually this is silent. The track is the one this command names.

**Offer rule** (full procedure: `/laneconductor:suggest-skills`). Plain text, never a form, never blocking.
- Look first: a skill is installed when it is in the session's skills list, `claude plugin list` (read only), `.claude/skills/` or `~/.claude/skills/`; an older name counts. Then say "you have `<skill>` installed, use it before writing the content" and use it.
- Offer only what is missing and fits this lane, the track's `**Type**` (dev if none) and the stack; else say nothing. At most two, ours first, never twice in a session, never one in `skills.declined` of `.laneconductor.json` (or older `.git/skill-advisor-declined.txt`).
- One or two plain sentences (what, why here, program or only knowledge), each install command alone in its own bash block, no leading `$`.
- `prerequisite`: ask, in the same sentence, whether to install first or carry on; otherwise a one-line tip. No answer: carry on.
- Never run an install yourself: the person runs it, then `/reload-plugins`. "Do not ask again": show the change; on a yes add it there (`.gitignore` first, asked).

Candidates for the `merge` lane:

- `superpowers`: skills finishing-a-development-branch. Installs a session-start hook script, plus Markdown skills. `claude plugin install superpowers@claude-plugins-official`

#### Skills that help here

Suggestions, a second opinion, never an order: if a skill named here is installed (for example from the Superpowers
plugin), consider using it; if not, say so in one line and carry on without it. `finishing-a-development-branch` helps with the last steps (what to merge, what to clean up, what to leave to the human) without skipping the question about pushing.

An optional top-level `skills` object in `conductor/workflow.json` may list more under `"merge"` (`{ "skills": { "merge": ["my-skill"] } }`): use them the same way (if one is missing, say so and continue). Absent, nothing changes. Where a skill's steps or file locations differ from this guide or the track files, those win; take the skill's method, not its output paths.

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
| `stay` or `stop` | no automatic move (older files; read, never written) |

An unknown current lane is an error; do not guess. Names are compared ignoring case and spaces. Fields of the older format
are ignored: `auto_action`, `parallel_limit`, `max_retries`, `global`, `primary_model`, `hooks`.

Worked examples. This project's own file:

| Lane | on_success | on_failure |
|------|-----------|-----------|
| plan | `plan:success` (stays, parked) | `backlog:queue` |
| implement | `review:queue` | `implement:failure` |
| review | `quality-gate:queue` | `implement:queue` |
| quality-gate | `done:queue` | `plan:queue` |
| done | none | `done:failure` |

An older file (bare targets, old lane names) resolves by the table above: `in-progress` with `"on_success": "review"` and `"on_failure": "in-progress"` gives `review:queue` and `in-progress:failure`; a `null` target has no automatic move.

#### Lane names

A project names its own lanes in `conductor/workflow.json`; the guides use the standard names, which replaced the old ones: `planning` to `plan` and `in-progress` to `implement` (older projects keep the old names; tracks are never renamed). The connector reports the mapping as `valid.guide_lanes` (the project's names as `valid.lanes`); without it, match by meaning. Write the project's own names into `**Lane**`.

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
(`success` or `failure`) and the `base` from `get_track` (it applies the workflow's move; `valid.next` says
where it goes); without it, read `workflow.json` with the grammar in `ops/lanes-and-statuses.md`.

#### pulse `[track-number] [status] [progress%] [summary?]`

Update the track's markers in `conductor/tracks/NNN-*/index.md`: `**Progress**: N%`, `**Phase**`
when the work entered a new phase, `**Step**` (the current activity),
`**Summary**`, and `**Waiting for reply**: no` after every AI response. A `[status]` that names a lane is a move, so use `move` for that;
`pulse` no longer writes the legacy `**Status**`.

#### comment `[track-number] [body]`

A comment from a person or an agent (an agent's answer to a human comment too) is a `> **author**: [body]` entry (format rules in SKILL.md) in
`conductor/tracks/NNN-*/conversation.md`. A note that records an event (a run, a classification, a completion) is a dated line
in `history.md` instead. Use `⚠️` for something that needs a human and `ℹ️` for a note.

### `SKILL.md` (Finding a track; conversation.md format)

#### Finding a track

A track number maps to one folder under `conductor/tracks/`. With the parallel add-on, `get_track` finds it. Without
it, use Glob `conductor/tracks/*-<N>-*/` for the form `INITIALS-NNN-slug` (for example `AM-10023-my-feature`) **and** `conductor/tracks/<N>-*/` for the older bare `NNN-slug`; scan for **both**. If neither finds it, `conductor/tracks-summary.md` (when it exists) lists the tracks.

If a folder exists for the number, use it: scaffolding a second is an error (a scan that missed `AM-<number>-...` once created a duplicate).

#### conversation.md format

`conversation.md` holds the dialogue. An entry that records an event (a lane completion, a classification) is a dated line
in `history.md` instead; with the connector, `append_conversation` with author `system` writes that line there. Every
entry in `conductor/tracks/NNN-*/conversation.md`, from an agent or a human, must look like:
```
> **author**: First line of the message
> second line, also prefixed with >
```
`author` is `human`, `claude`, `gemini` or `system`. The tools that read it recognize only
`> **author**: ...` lines plus `>`-prefixed continuations. Anything else (a header, a plain
blockquote, loose prose) stays in the file but is never read, with no error.
For long pasted material (an email, a contract) keep one opening `> **author**:` line and
prefix every following line, blank ones and headers included, with `>`.

### `SKILL.md` (The closing message of a lane)

#### The closing message of a lane

The last chat message of a lane command (and of an owner-step reply) is six lines at most, with no heading:

1. **Outcome**, one line: what was done and where the track sits now, with its title and a gist: `Planned AM-1 "Title" (6 phases, 12 tests): <one clause on the approach>; parked at plan:success.`
2. **Needed from the person**: what blocks the next step, three lines at most, one each (a supervised track: its Owner Action; a plan item marked unverified or open that blocks building). None: leave it out.
3. **Next**: the command alone, for the lane the track now sits in (`/laneconductor:implement N`; after a merge, `/laneconductor:next`).
4. **More**, word for word: ``More: `/laneconductor:board` (the track's card shows the next step with a Copy button), or say "show the plan".``

Findings, phase and test-case lists, risks and caveats go into the track's files and its one completion comment, not the chat; give them on "show the plan". Say nothing of commits or ignored tracks unless unusual.
