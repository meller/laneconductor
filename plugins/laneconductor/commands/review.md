---
description: Review a track's implementation (recommends one sub-agent per track in its own worktree)
argument-hint: <track number or title>
---
Review track `$ARGUMENTS`. The procedure is the review lane guide (skill file `lanes/review.md`); follow it and do not restate it here.

This command carries the skill text it uses, at the end under "Reference". Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the command are references only.

1. Find the track's folder under `conductor/tracks/` (Glob `conductor/tracks/*<number>*/`; both naming conventions exist, see "Finding a track" in the skill index) and read its `index.md`, `spec.md`, `plan.md`, `test.md` and `conversation.md`. Read the lane guide too. Read where a lane sends a finished track from `conductor/workflow.json` with the grammar of the skill file `ops/lanes-and-statuses.md` (a bare target is `queue` for another lane and `success` or `failure` for the same lane; a bare `done` is `done:queue`); never guess it from the raw file.
2. If the sub-agent `laneconductor-parallel:track-runner` is listed (the add-on is installed): RECOMMEND, do not start: one sub-agent per track, each in its own worktree, because that isolates the work from the primary checkout, lets several tracks run in parallel, and keeps them from colliding. Show the exact dispatch, with this prompt: "Review track N in the review lane: read the lane guide, evaluate the work, do not fix it, report a verdict with evidence; do not merge or push." Start nothing until I say yes; if I decline, do the lane yourself. If it is not listed: do the lane in this session following the guide. If I ask for parallel work or for isolation, explain the by-hand way (`git worktree add .worktrees/track-<number> -b track-<number>`, a separate session started in that folder, one track per worktree) and, once, what the laneconductor-parallel add-on adds (parallel work: sub-agents per track in worktrees, conflict-checked track writes; It installs an MCP server (a Node.js program) and a scaffold script on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory. Show its install commands as written, from "The add-on's install commands" in the Reference below; never run them). Otherwise mention nothing.
3. Change state by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.

In Claude Code the add-on's sub-agent is `laneconductor-parallel:track-runner`. See "Plugin users" in the skill's `ops/working-a-track.md`.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__get_context`, `mcp__plugin_laneconductor-parallel_lc__get_track`, `mcp__plugin_laneconductor-parallel_lc__update_track`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.

## Reference

From the skill files this command names, copied here: whole files, or only the sections the command uses.

### `lanes/review.md`

Evaluate the implementation against the plan and the product guidelines, post the verdict as a
comment, and route the track. This lane only evaluates: fixing the bugs it finds hides them from
the implement lane's retry loop, so write them up as gaps instead.

0. **Claim the track first.** Write `**Lane**: review` and `**Lane Status**: running` to the
   track's `index.md`. Set `**Lane**` explicitly: when the command is run directly the track may
   not sit in this lane, and the board would show it running in the wrong column. In the same
   edit, clear any existing `**Verdict**` marker, so a run that is cut short never leaves a stale
   value for a later run's exit handler to misread.
1. **Load context.**
   - Unless `FRESH_SESSION: false` (review often resumes the session implement used), read
     `plan.md`, `spec.md`, `test.md`, and `product-guidelines.md`, `design-language.md`,
     `deployment-stack.md` where present.
   - Always read `conversation.md` (create it if missing): it shows whether earlier review gaps were addressed and
     whether the human gave specific instructions.
2. **Evaluate** the implementation against the requirements and guidelines.
   - Secrets: no hardcoded secrets or secrets in logs; ADC / Secret Manager used as
     `deployment-stack.md` specifies.
   - If `test.md` exists, run its test commands. A failing test case makes the verdict FAIL.
3. **Post the review** as one dated verdict line in `history.md`, emoji first:
   `- <YYYY-MM-DD HH:MMZ> ✅ REVIEW PASSED` or `- <YYYY-MM-DD HH:MMZ> ⚠️ REVIEW FAILED`. Put the write-up (test summary,
   gaps) in one comment in `conversation.md` (authored `claude`, `>`-prefixed continuation lines), not a second one;
   the history line stays one line, and no status goes into `plan.md` or `spec.md`.
4. **Transition.**
   - Re-read `index.md`'s `**Lane**`. If it is no longer `review` (a human moved the card), leave
     `**Lane**` and `**Lane Status**` alone, keep the step 3 comment (the review is still valid),
     and note in it that the transition was skipped.
   - Otherwise take the move from the workflow: with the connector, `update_track` with
     `outcome: "success"` (PASS) or `"failure"` (FAIL), the target being `valid.next` in
     `get_track`; without it, read `conductor/workflow.json` with the grammar in
     `ops/lanes-and-statuses.md` and set `**Lane**` and
     `**Lane Status**` from `lanes.review.on_success` or `on_failure`.
   - **PASS:** apply the success move (this project: `quality-gate:queue`),
     append `## ✅ REVIEWED` to `plan.md`, and in the same edit write `**Verdict**: pass`.
   - **FAIL:** apply the failure move (this project: `implement:queue`), add
     `⚠️ Gaps` to `plan.md`, and in the same edit write `**Verdict**: fail`.
   - Write `**Verdict**` every time, PASS or FAIL. The harness can tag the same
     turn `blocked` (for example a question surfaced mid-review) although step 4 already reached
     a routable outcome; the run's exit handler reads `**Verdict**` before that tag, so
     a resolved review is routed instead of parked indefinitely.

#### Offer a missing skill

Before the work, look at what fits this lane and offer what is missing; usually this is silent. The track is the one this command names.

**Offer rule** (full procedure: `/laneconductor:suggest-skills`). Plain text, never a form, never blocking.
- Look first: a skill is installed when it is in the session's skills list, `claude plugin list` (read only), `.claude/skills/` or `~/.claude/skills/`; an older name counts. Then say "you have `<skill>` installed, use it before writing the content" and use it.
- Offer only what is missing and fits this lane, the track's `**Type**` (dev if none) and the stack; else say nothing. At most two, ours first, never twice in a session, never one on the declined list (`skill-advisor-declined.txt` in the directory `git rev-parse --git-common-dir` prints).
- One or two plain sentences (what, why here, program or only knowledge), each install command alone in its own bash block, no leading `$`.
- `prerequisite`: ask, in the same sentence, whether to install first or carry on; otherwise a one-line tip. No answer: carry on.
- Never run an install yourself: the person runs it, then `/reload-plugins`. "Do not ask again": after a yes, add the entry name to the declined file.

Candidates for the `review` lane:

- `laneconductor-parallel`: parallel work: sub-agents per track in worktrees, conflict-checked track writes. Installs an MCP server (a Node.js program) and a scaffold script. It counts as installed when its connector tools exist (`mcp__plugin_laneconductor-parallel_lc__*`), or its agent `laneconductor-parallel:track-runner` is listed. Mention only when several sessions, people or sub-agents write the same tracks, or overwrites are a worry. `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-parallel@laneconductor`
- `superpowers`: skills requesting-code-review, receiving-code-review. Installs a session-start hook script, plus Markdown skills. `claude plugin install superpowers@claude-plugins-official`
- `pr-review-toolkit`: skills review-pr. Markdown only. `claude plugin install pr-review-toolkit@claude-plugins-official`

#### Skills that help here

These are suggestions, in the same spirit as the rest of this guide: a second opinion, never an order. If a skill
named here is installed (for example from the Superpowers plugin), consider using it; if it is not, say so in one line
and carry on without it. `requesting-code-review` helps frame what to check and how to report it; `receiving-code-review` helps when feedback arrives and each point needs to be checked before acting on it.

Also read `conductor/workflow.json`. If it has a top-level `skills` object with a list under `"review"`, such as
`{ "skills": { "review": ["my-skill"] } }`, use those skills in addition, the same way: if one is installed, use it; if
it is missing, say so and continue. The `skills` key is optional; when it is absent, nothing changes. Where a skill's
own steps or file locations differ from this guide or from the track files, the track files and this guide win; take the
skill's method, not its output paths.

### `ops/working-a-track.md`

For "run track N", "work on track N" or "take track N through its lanes". Do the work however you
normally would - use sub-agents and worktrees as you see fit. This is a second opinion, not a
rulebook: it says what exists here and what has gone wrong before. If you have a better reason to
do otherwise, do so and say why.

Find the folder as "Finding a track" in the index says. Lane definitions and
transitions are in `conductor/workflow.json`; what each lane means is in `lanes/`: read the lane
file for the lane you are about to run. Keep `**Lane**`, `**Lane Status**`, `**Progress**` and
`**Phase**` in the track's `index.md` true as you go.

#### Lessons (each came from a real incident - use judgment)
- Code work happens in a worktree `.worktrees/N` on branch `track-N`, not the primary checkout.
  Docs-only lanes (plan) need no worktree: work in the primary checkout.
- A new track folder is untracked, so a worktree off HEAD cannot see it: commit just that folder
  to main locally first (a worktree is the only reason this is needed; pushing is not).
- Before touching a dirty primary checkout, check for a live process using it as cwd.
- Do not open a track for a gap you find on the way until you have searched: list the tracks by the key words (every lane, backlog and done too), and if one fits ask "Update track N (title, lane) with this? [default: yes]" and extend it. Several small gaps go into one fitting track, an epic or one backlog track. See "Search first" in `ops/tracks.md`.
- One session per track. If something else also works the track (another session, an automatic runner), stop and ask.
- Do not run test suites that start background processes from inside a worktree: they can attach
  to the real primary checkout and leak processes. Check for leftovers after any test run.
- Ask before merging or pushing (it is the human's call). Never enter, echo or store secrets.
- Append to `conversation.md` as `> **author**: text` (every line prefixed `> `); anything else
  is silently ignored by sync.
- If a decision is the human's, ask in `conversation.md`, set `**Waiting for reply**: yes`, and stop.

#### Plugin users: one subagent per track in a worktree
With the optional laneconductor-parallel add-on installed (Claude Code or Cowork, not chat), its `laneconductor-parallel:track-runner`
subagent is the recommended way to work a track: one subagent per track, each in its own worktree,
so code stays off the primary checkout, tracks run in parallel and do not collide, and the add-on's
conflict-checked writes keep the shared track state safe. Recommend it and show the exact dispatch (agent name and
one-line prompt); start nothing until the human says yes. `/laneconductor:run N`, `:implement N` and `:review N` do this
when the agent is listed. It never merges or pushes.

Without the add-on, work the lane in this session, or by hand in a worktree: `git worktree add .worktrees/track-N -b track-N`,
a separate session started in that folder, one track per worktree, and never `git add -A` there. Say what the add-on adds
(isolated sub-agents, safe shared state) only if the person asks for parallel work; the install commands are under "The add-on's install commands" below.

### The add-on's install commands

Show these as written when the add-on is missing and I ask for parallel work or isolation; never run them.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-parallel@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-parallel@laneconductor` instead (that opens the plugin's details for review).

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
