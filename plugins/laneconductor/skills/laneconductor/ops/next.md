# next: name the one next step

`next` is the front door. It looks at where the project stands, names the single next step with the exact command to type, what it
does and why it comes next, and teaches the lane model a little at a time. Use it when the person is not sure how to continue
("what's next", "what now", an answer of "I do not know" to anything you asked), in any project state, including a folder with no project.

## When to use it

- The person types `/laneconductor:next`, or says one of the phrases above. You may start it unprompted when they are plainly lost.
- It is read only: no claim, no marker, no file, no install, no push; the one write is the personal level setting (see
  "Levels"), after asking. A reply of "go" runs the command the card named as if the person had typed it: the card names it, and `go` is the consent.
- It names one step; other candidates go in one line (at most three, then "and N more").

## Gather

Read in this order; stop as soon as the state is clear, with or without the parallel add-on.

1. **Is this a repository?** `git rev-parse --is-inside-work-tree` (read only). Note the default and the current
   branch, and whether the folder holds anything besides `.git`. For the number of commits run `git rev-list --count HEAD`.
2. **Is the project set up?** Look for `conductor/`, `conductor/workflow.json` and `conductor/tracks/`.
3. **List the tracks.** Glob `conductor/tracks/*/index.md`, skipping archived folders (`_duplicate-*`, `_quarantine-*`). One Grep
   for the header markers is enough; open a track's own files only for the candidates the card names.
   With the parallel add-on, call `list_tracks` instead (filters `lane`, `lane_status`; `lane: done` with `lane_status: queue` shows
   the gated tracks), then `get_track` for the track you name, for `valid.next` and the freshness line. Say so in one line before the card only when its reasons need the person: `behind_upstream`, `unpushed_local_commits`, `dirty_state_files`, a stale claim. No upstream (`no_upstream`) or a rebuilt summary (`track_summary_regenerated`) is normal: no line. It also reports `blocked_by` (the numbers not
   yet `done:success`) and `ready_to_resume`: use them for S09 and S10; without it, work them out from `Waiting On Tracks` and `Depends On`.
4. **Read these markers**, header block only, the first one wins when a marker is repeated (and the track is damaged, S21):
   `Lane`, `Lane Status`, `Progress`, `Phase`, `Depends On`, `Waiting On Tracks`, `Waiting for reply`, `Priority`, `Part Of`, `Merge Mode`,
   `PR URL`, `Owner Action`, `Owner Action Due`, `KPI Check After`. Match lane names by meaning (a project may still say `planning` and `in-progress`: use `conductor/workflow.json`, or
   `valid.guide_lanes`), and write the project's own lane names in the card.
4b. **Today's date.** S22 and S23 compare days: take today as a UTC calendar day from the system or the freshness line.
   If you do not know it, ask the person for it; never guess. With the add-on, `list_tracks` and `get_track` report `overdue` and `ready_to_measure` (UTC); without it, compare the days yourself. Due today is not overdue.
5. **Where a finished lane goes next** is never guessed from the raw file: use `valid.next` of `get_track`, or read
   `conductor/workflow.json` with [lanes-and-statuses.md](lanes-and-statuses.md). Say it in one clause.
6. **Git facts, read only.** For a track in `done:queue`: does a local branch for it exist (`git branch --list`), and is it an
   ancestor of the default branch (`git merge-base --is-ancestor`)? When no branch exists, does the default branch have a commit
   for it (`git log --grep` on `(track-N)`)? A commit counts only when its subject is NOT one of the connector's own state commits,
   `chore(track-N): <tool> ...` (`<tool>`: one of its three write tools): those record files, not shipped work.
   For a track that is `running`: the time of the last commit that touched its folder or a branch named for it
   (`git log -1 --format=%ct -- <folder>`, `git for-each-ref`). A fact you cannot establish is not guessed: ask one question instead.
7. **Comments.** `conversation.md` is not committed: read it only when it exists here, and never rely on it. The committed signal
   for a reply that waits is the marker `Waiting for reply: yes`. When the file exists and its last entry is the human's
   (`> **human**:`) with no later `system` or agent entry, the track waits for a reply even if the marker says no.
8. **Stub files.** A `plan.md` is a stub when it is missing, holds the placeholder "Plan to be written in the plan lane", or has
   no checkbox. A `test.md` is a stub when it is missing, holds "(Test cases to be added)", or has no test case line. Real content
   (phases, checkbox tasks, `TC-` lines, ticked or not) is NOT a stub: look for the checkbox and the `TC-` line, not for completeness.
9. **A project summary** (`conductor/tracks-summary.md`) may preselect tracks in a very large project (about 100 or more);
   confirm every track the card names from its own `index.md`.

## States

Each row is one state: what the files show, what the card says and the command. Tracks in `backlog`, tracks in `done:success` and
archived folders are never candidates, except in S19 and S20. A track that waits on an unshipped track (S10) is never the step,
whatever its lane. An epic (a track that other tracks name with `**Part Of**`) is not a candidate either: its children are. Add one
line to the card for an epic that has unfinished children ("Epic N: 3 of 8 children done"), counted from the children's own markers;
the epic's own file holds no child status.

| Id | The project shows | The card names | Command |
|----|-------------------|----------------|---------|
| S01 | The folder is not a git repository | Setup, which offers `git init` first (explain level: also the three paths of S02) | `/laneconductor:setup` |
| S02 | A repository (or any folder, even an empty one) with no `conductor/` folder | The front door. Default level: the first card (see "The first card"), a read only analysis and one reply, `go`. Explain level: three paths. (a) Continue this project: `go` runs `setup`: it reads the stack, writes the `conductor/` files and files the plan's first items as tracks. (b) Start a new project: a short brainstorm, then the scaffold and first tracks. (c) Look around: four sentences on what LaneConductor is (the plan-first process, tracks as files in git, five lanes, nothing to install but this plugin) and the list from `help`; nothing is written. A repository with history defaults to (a); an empty or nearly empty folder (no code, no plan document) defaults to (b). Then the add-ons and the board (see "The front door") | `/laneconductor:setup`, `/laneconductor:new-project`, `/laneconductor:help` |
| S03 | `conductor/` exists but `workflow.json` or `tracks/` is missing | Finish the scaffold: setup again, it skips what exists. Explain level: then the add-ons and the board (see "The front door") | `/laneconductor:setup` |
| S04 | Set up, and no track folder under `conductor/tracks/` | Create the first track. Default level: the first-track card (see "The first-track card"). Explain level: the primer, the card, then the add-ons except the board (see "The front door") | `/laneconductor:new <title>` |
| S05 | A track (with no `Owner Action`, see S22) waits for a human reply: `Waiting for reply: yes`, or `Lane Status: waiting` with no `Waiting On Tracks` and no unmet `Depends On` (a question or an approval), or the last comment is the human's and unanswered | Answer it: show the last comment in two lines, say what the track needs, offer the answer path (a comment, then resume with `move`) | `/laneconductor:comment N <your answer>` |
| S06 | A track is in `failure` in its lane (`implement:failure`, `plan:failure`, `quality-gate:failure`) or is `done:failure` (a merge that failed) | Read its last comment, then offer a retry and a replan and recommend one by lane (implement failure: retry implement; plan, review and quality-gate failure: replan; done failure: fix the cause, then merge again) | `/laneconductor:implement N`, `/laneconductor:plan N` or `/laneconductor:merge N` |
| S07 | A track is `running` and looks abandoned: the last commit on its folder or branch is older than 6 hours | Ask, do not decide: "N says it is running for H hours with no commit; is something still working on it?" If not, set `Lane Status` back to `queue`, then run the lane again | `/laneconductor:move N <lane>:queue` |
| S08 | A track is `running` and recent | Say so and leave it alone ("N is being worked on; start nothing on it"); the card goes on to the next candidate | none |
| S09 | `waiting` on tracks (`Waiting On Tracks`, else `Depends On`) and every named track is `done:success` | Resume it: the dependencies shipped; say which. Setting `queue` and clearing the parking markers is the resume | `/laneconductor:move N <lane>:queue` |
| S10 | The track names tracks it waits on (`Waiting On Tracks`, else `Depends On`) and at least one is not `done:success`, and it is `waiting` or `queue` (a track that is `running`, in `failure` or waiting for a reply is read as S05 to S08 first). `done:queue` is gated, not shipped, and does not count | Not a candidate: named in the "also" line as blocked by those tracks; a blocker that is itself a candidate is ranked as usual | none |
| S11 | `done:queue` and the track's branch is not merged (or that cannot be established) | Merge it: it passed the quality gate and is not shipped. The merge command asks before any merge or push; a non-dev track has no branch, there it records `done:success` | `/laneconductor:merge N` |
| S12 | `done:queue` and its branch exists and is already an ancestor of the default branch, or no branch exists and the default branch has a commit for it that is not one of the connector's own state commits (`chore(track-N): <tool> ...`, see step 6) | It looks merged: ask the person to confirm, then record it | `/laneconductor:move N done:success` |
| S13 | `done:waiting` (a pull request is open) | The pull request waits for a person to merge it: show `PR URL`; once it is merged, record it | `/laneconductor:move N done:success` |
| S14 | `quality-gate:queue`, or `review:success` when the workflow does not move on by itself | Run the quality gate: it evaluates and never fixes | `/laneconductor:quality-gate N` |
| S15 | `review:queue`, or `implement:success` when the workflow does not move on by itself | Review the implementation: it evaluates and never fixes. A code track with the parallel add-on: recommend one sub-agent in its own worktree | `/laneconductor:review N` |
| S16 | `implement:queue`, or `plan:success` (plan done, parked) with a real plan and real test cases | Implement it from its plan. A code track with the parallel add-on: recommend one sub-agent in its own worktree; otherwise, and for a non-dev track, in this session | `/laneconductor:implement N` |
| S17 | `implement:queue` or `plan:success`, but `plan.md` or `test.md` is missing or still the empty stub from track creation | Plan it first: there is nothing to implement from. This overrides S16 | `/laneconductor:plan N` |
| S18 | `plan:queue` | Plan it: the plan lane writes the spec, the plan and the test cases, and no code, so the work is agreed and testable first | `/laneconductor:plan N` |
| S19 | The only tracks that are not shipped are in `backlog` | Pick one to start: show up to three, recommend the oldest, and say that moving it to `plan:queue` starts it | `/laneconductor:move N plan:queue` |
| S20 | Every track is `done:success`, or none is ready | Nothing waits. First "What is still in the plan" below: the plan's items that have no track. None left: offer `new`, `board` to look at the whole project, `status` for the list | `/laneconductor:new <title>` |
| S21 | A track's markers cannot be read: a repeated `Lane` block, no `Lane`, a lane or status that is not in the workflow, two folders with one number | Name each such track and the fault in one line each, read it by its first marker, never rank it above a readable track; if every candidate is unreadable, the step is to fix the first one by hand | none (or `status`) |
| S22 | `Lane Status: waiting` (also `done:waiting`) with an `Owner Action`: a step only the person can do (post, record, approve, submit). Read before S05, even when `Waiting for reply` is yes or a dependency is unmet | Do the owner action: quote it, say its `Owner Action Due` day (`overdue since <day>`, `due today`, or `no due date` when it is missing or not a real `YYYY-MM-DD`) and point to the `## Draft` section of `spec.md` for the kit. The agent posts, sends and spends nothing for the person. When it is done, the person comments and the agent clears both markers and starts the run window | `/laneconductor:comment N <what you did>` |
| S23 | `Lane Status: waiting` with no `Owner Action`, no reply asked for and no unmet dependency, and `KPI Check After` is today or earlier (a `YYYY-MM-DD` day, or a UTC timestamp not later than now) | Measure the KPI: the run window ended. The quality gate reads the KPI from its source or asks for the number, and never invents one | `/laneconductor:quality-gate N` |

In the commands, `N` is the track number. A shell command (an install command) goes alone in its own
bash block; a slash command is inline code, in the form the person's client uses (`/laneconductor:plan N` in Claude Code; the
prompt `plan` elsewhere).

## Rank

Apply to the readable candidates of S05 to S19 and S22 and S23, first difference wins:

1. **Human reply.** An owner action (S22) comes first: oldest due first (an overdue one is the oldest), a missing or malformed due date last. Then a track that waits for an answer (S05). Both come before everything else.
2. **Failed or stuck.** A failure (S06) or a claim that looks abandoned (S07).
3. **Ready to resume.** A parked track whose dependencies shipped (S09), or whose run window ended (S23).
4. **Priority.** The optional marker `Priority` (`high`, `normal`, `low`; absent means `normal`): high before normal before low.
5. **Lane order, latest lane first.** `done:queue` (merge), then quality-gate, review, implement, plan. Nearly shipped work comes before work not begun.
6. **Number.** Lowest track number first (the oldest request first).

With more than two tracks in S22, add one line after the card: "You have N open owner actions: finish one before starting another." It is advice only: it changes no order.

A `running` track (S08) and a blocked one (S10) are skipped and named in the "also" line. When several tie at the top, name
the first and list the rest in one line. When you chose between several, say the rule in one sentence ("a human reply comes first").

With a track number as the argument ("what's next for N"), give the same card restricted to that track.

## The card

Always: the step with its command; one sentence on what it will do (and in one clause where the track goes when it
finishes); one sentence on why it comes next; the other candidates in one line (none: left out); one pointer to the lane statuses, in words (never a file path); and the closing offer "Say go and I will run it here", except when the command asks for confirmation itself (`merge`, `deploy`): the card then ends with the command, so the person confirms once. The first card has its own reply, `go`. The card never names a
track number outside the track it is about, and never mentions work that does not exist yet (the first-track card's suggestions apart).

Explain form:

> **Next: plan track N, "<title>".** Run `/laneconductor:plan N`.
> **What it does:** writes the spec, the plan and the test cases, and no code. **Why now:** this is the oldest track waiting.
> Also waiting: N2 (implement), N3 (review). More on the lanes: `/laneconductor:workflow`. Say go and I will run it here.

## The first card

S01 and S03 rank nothing; the card is these three lines:

> **Next: set this project up.** `/laneconductor:setup`
> It reads this project, asks only about anything unusual, then writes the `conductor/` files it lacks.
> More (the lanes, the other paths, the board and the add-ons): `/laneconductor:next explain`.

S02 is a read only analysis (README, `package.json`, `git remote`, the plan documents of "The first-track card") and ONE reply, `go`, which runs the command the card names. No why line, primer, paths, board or add-ons note; a count comes from a command (`git rev-list --count HEAD`). An existing project (code, or a plan document):

> **Next: set this project up.** Nothing is written yet.
> **my-app**: a command-line tool that sorts notes (Node.js).
> Your plan, `docs/plan.md`:
> 1. A publish checklist
> 2. An /openapi.json door
> 3. A /prompt paste pack
> 4. Plugin packaging
> 2 more in `docs/plan.md`. Open question there: browse-only dry-run variants? (not filed)
> Tracks will be private (git-ignored): the README says this is a public demo.
> Reply **go** and I run `/laneconductor:setup`: it sets up LaneConductor, keeps the tracks private and files the four plan items above as tracks in the plan lane.
> More: `/laneconductor:next explain`.

The plan lines are those of "The first-track card". The tracks line is setup's declared choice: private with its reason, or "Tracks will be committed with the code." With no plan document leave the plan lines out and end the reply line "...keeps the tracks private; no plan document, so it files nothing." A new project (an empty or nearly empty folder: no code, no plan document; a README or licence alone does not count):

> **Next: start a new project.** No code and no plan document here.
> Reply **go** and I run `/laneconductor:new-project`: a short brainstorm about the idea first (options and decisions, nothing written), then the scaffold, the first tracks and a starter set of suggested skills.
> More: `/laneconductor:next explain`.

## The first-track card

S04 at the default level, and the close of `setup` (with no plan document) and `new-project`. Nothing is created before the person answers. With a plan (below) the card leads with it:

> **Next: your first track.** From your plan in `docs/plan.md`:
> 1. A publish checklist
> 2. An /openapi.json door
> 3. A /prompt paste pack
> 4. Plugin packaging
> 2 more in `docs/plan.md`. Open question there: browse-only dry-run variants? (not filed)
> 5. Choose a licence: the README says none is chosen
> 6. Audit: review the code for privacy, security and quality, and file each finding as its own track
> The project on a board: `/laneconductor:board` (the files setup wrote, later the tracks).
> Reply with numbers, "all 6 plan items", or tell me a title of your own.

- **The plan** (read only, one look): `docs/plan.md`, `PLAN.md`, `ROADMAP.md`, `TODO.md`, `docs/roadmap*.md`, and README sections on the roadmap, next steps, status, todo or what is missing. Items, in the file's order and words, cut to one line: unticked checkboxes, else bullets or numbered lines, else `###` headings, of the sections on what is still to come; never a ticked, struck-through or "done" one. A decision or question still open (a heading with decision, open or question, or a line ending "?") is an open question, not an item.
- **With a plan**: the lead names the file; at most four items, "N more in `<file>`", at most two open questions; then, only for what the plan does not say, at most two generic suggestions, the audit last.
- **Without a plan**, only generic suggestions, at most four, one line each: the title, then the fact behind it in a few words. In this order: no licence file or the README says none is chosen (Choose a licence); the README or `package.json` says public, demo or open source (Check the repository for secrets and personal data before it is public); no CI files but a test command (Add CI that runs `<the test command>`); no lint or format config (Add a lint and format check); no `SECURITY.md` (Add a SECURITY.md); no lockfile (Pin the dependencies). Keep the first three that fit, then always last: Audit: review the code for privacy, security and quality, and file each finding as its own track. The reply line has no "all".
- **Never invent**: every line is text from a file (named) or a fact a command or a read checked.
- **The board line**: always the one in the card above, `/laneconductor:board`. That command looks for the board add-on itself and, when it is missing, says so and shows the install commands; so detect nothing and show no install line here.

- **The answer**: numbers, "all N" (every plan item, the hidden ones too) or a title. For each, in the plan's order, follow `new`: search first (a fitting track is offered an update), then create in the plan lane, the plan item as the problem ("From `docs/plan.md`: <the item as written>"). An open question is filed only if asked. Setup files the first four the same way, with no question.

## What is still in the plan

In S20, before the offer to create a track: look for the plan as above and drop the items that already have a track. Compare the plain text (lower case, no punctuation or numbers, words of four letters or more) of an item with each track's title and problem (`spec.md`, else the `index.md` summary): all the item's words in one track: it has a track, leave it out; at least half of them, or all of a title's words in the item: show it ending "(may already be a track)". Show the card led "**Next: what is still in your plan.**", with no generic suggestions and no audit. None left, or no plan: the S20 offer.

## Levels

There are three levels: `auto` (the default), `explain` and `short`.

- `explain` adds a primer in plain words, then the card (in S01 to S04: the full text of the table row, S04: the first-track card, then the front door). At most twelve lines, not repeated in the same session:
  - There are five lanes: plan, implement, review, quality-gate, done. Each track sits in one lane.
  - Plan writes the documents (spec, plan, test cases). Implement builds from the plan. Review and quality-gate judge the work and
    never fix it. Done merges it.
  - There are five statuses: `queue` (waiting to start), `running` (someone is on it), `success`, `failure`, `waiting` (parked for a
    reply or for other tracks).
  - `done:queue` means gated but not merged yet; `done:success` means it is in the main branch.
  - A marker is a bold line at the top of a track's `index.md` (`**Lane**: plan`); it is the track's state, kept in git.
  - The order is plan, implement, review, quality-gate, merge, so each step has something agreed to check against.
- `short` is the one-line card: the step, the command, a six-word why and the other candidates ("**Next: plan track N.** `/laneconductor:plan N`, the oldest request waiting. Also: N2, N3."). In S01 to S03 it is the first card, in S04 the first-track card.
- `auto` is stateless: it behaves as `short` in S01 to S04 (the first card, with its pointer to `next explain`; in S04 the first-track card), as `explain` whenever the project is young, meaning fewer than three tracks are
  in review, quality-gate or done, and as `short` otherwise.

`next explain` and `next short` (or the same words said aloud) set the level for that answer whatever the setting says. The saved level is `next.level` in the optional personal settings file `.laneconductor.json`
([settings.md](settings.md)); a missing or unreadable file or an unknown value means `auto`, with no message (one line when
the file is not valid JSON).

If the person asks to keep a level ("always short", "keep explaining"), ask before writing. If `.laneconductor.json` does not
exist, say you will create it holding only `next.level` and add `.laneconductor.json` to `.gitignore` (it is personal);
do both only after a yes, keeping every other key of an existing file. On no, write nothing. Nothing else is stored.

## The front door

At the explain level in S02, S03 and S04 the card is followed, once per session, by the optional add-ons that fit this
project and are not installed. Show them; never run an install. One installed, already offered this session or declined is not offered. At the default level, and in later runs with tracks, add-ons are not offered on the card: they come up when the person asks for parallel work, a board or a worktree. Detect an installed add-on as the first-track card says; if you still cannot tell and the person says it is installed already, take their word.

The board is also named when it is installed. At the explain level in S02 and S03 add one sentence, once: `/laneconductor:board` opens the whole project as a board, and its What's next button shows the same step as `/laneconductor:next`. The loop: open the board, copy the step, run it here, refresh.

Show each entry's commands alone in its own bash block (no leading `$`), then the reload step (`/reload-plugins`), and say plainly what it installs.

- `laneconductor-parallel`: parallel work: sub-agents per track in worktrees, conflict-checked track writes. Installs an MCP server (a Node.js program) and a scaffold script. It counts as installed when its connector tools exist (`mcp__plugin_laneconductor-parallel_lc__*`), or its agent `laneconductor-parallel:track-runner` is listed. Mention only when several sessions, people or sub-agents write the same tracks, or overwrites are a worry. `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-parallel@laneconductor`
- `laneconductor-board` (Type dev/marketing/sales/support): the board: one private page of every track by lane. Installs a script (a Node.js program, no packages) and its page. It counts as installed when Glob `**/laneconductor-board/**/bin/lc-board.mjs` under `~/.claude/plugins/cache` (installed plugins only) finds `lc-board.mjs`. Mention only when the person asks for a board or dashboard (`/laneconductor:board`, `/laneconductor:board refresh`). `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-board@laneconductor`

When BOTH add-ons are missing and you offer both, show the "one line" of the first-track card above instead of two blocks, then the reload step.

```bash
claude plugin marketplace add meller/laneconductor && claude plugin install laneconductor-board@laneconductor && claude plugin install laneconductor-parallel@laneconductor
```

## A skill tip

After a ranked card (not the first card), add at most ONE line, once per session, when a skill that fits the step's lane and the track's `**Type**` is not installed: "Tip: `<skill>` (<one clause on why>) is not installed; `/laneconductor:suggest-skills` shows how." Look first (the skills list, `claude plugin list`, `.claude/skills/`). Say nothing when nothing is missing or the person declined it (named in `skills.declined` of `.laneconductor.json`); never show a command here.

**The current track** is, in this order: the track named in the prompt (a number or a title); the track a branch is named after (`git branch --show-current`, matched to its folder under `conductor/tracks/`); the track this session has running (`**Lane Status**: running`, and with the connector `**Run By**` names this client). With one in play, its lane, `**Type**` and stack apply; with none, no track is in play and skill offers go by the stack only (a KPI block belongs to a marketing or sales track, so there is none to write).

Skills that fit each step's lane:

- brainstorm: `superpowers`
- plan: `frontend-design`, `marketing-skills`, `superpowers`, `customer-support`, `data`
- implement: `laneconductor-parallel`, `frontend-design`, `marketing-skills`, `superpowers`, `firebase`, `cloudflare`, `customer-support`, `data`
- review: `laneconductor-parallel`, `superpowers`, `pr-review-toolkit`
- quality-gate: `marketing-skills`, `superpowers`, `security-guidance`, `playwright`
- merge: `superpowers`
- deploy: `firebase`, `cloudflare`

## A stale project-level skill

A copy or link at `.claude/skills/laneconductor` is left over from an older install: the plugin supplies the skill itself. Look read only (Glob, `test -L` for a link, `git ls-files` for whether git tracks it).
If it exists, say after the card: "This project has its own copy of the LaneConductor skill (`.claude/skills/laneconductor`);
the plugin already supplies it, so the copy is stale." Offer its removal, the command alone in its own bash block; never run it. For a link that git does not track:

```bash
rm .claude/skills/laneconductor
```

For a folder that git does not track, `rm -r .claude/skills/laneconductor`; for one that git tracks, `git rm .claude/skills/laneconductor`
(`git rm -r` for a folder), which then needs a commit: ask first.

## Rules

- Read only. Ask before writing. Never push. Never run an install: show the command.
- One step: a command the person can type, never a vague direction.
- The marker lines of a track are never edited by `next`, including a `running` claim that looks abandoned: ask, then let the
  person decide.
- Never state a fact you could not establish. A count (commits, tracks, files) comes from a command or a read run for that purpose, never from a truncated listing; if you did not run one, say no number.
