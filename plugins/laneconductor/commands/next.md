---
description: Name the one next step for this project and explain it (read only)
argument-hint: "[explain | short | track number]"
---
What's next: `$ARGUMENTS` (nothing given means the whole project). Read only: change no file and no marker, install nothing and push nothing. In Claude Code, type it as `/laneconductor:next`; the commands in the card are written in that form.

This command carries its whole procedure below: it is the text of the skill file `ops/next.md`, in full, then what it needs from `ops/lanes-and-statuses.md` (in "Reference"). Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the text are references only.

`next` is the front door. It looks at where the project stands, names the single next step with the exact command to type, says in
one sentence what that step does and in one why it comes next, and teaches the lane model a little at a time. Use it when the
person is not sure how to continue ("what's next", "what now", an answer of "I do not know" to anything you asked), in any project state, including a folder with no project.

## When to use it

- The person types `/laneconductor:next`, or says one of the phrases above. You may start it unprompted when they are plainly lost.
- It is read only: no claim, no marker, no file, no install, no push. The one write it may do is the personal level setting (see
  "Levels"), after asking. If the person says "go", run the command it named as if they had typed it.
- It names exactly one step. Other candidates go in one line (at most three, then "and N more").

## Gather

Read in this order; stop as soon as the state is clear. With or without the parallel add-on the procedure is the same; only the
way of gathering differs.

1. **Is this a repository?** Look for `.git` (`git rev-parse --is-inside-work-tree`, read only). Note the default branch and the
   current branch. Note whether the folder holds anything besides `.git` (an empty folder, or one with files). For the
   number of commits run `git rev-list --count HEAD`.
2. **Is the project set up?** Look for `conductor/`, `conductor/workflow.json` and `conductor/tracks/`.
3. **List the tracks.** Glob `conductor/tracks/*/index.md`, skipping archived folders (`_duplicate-*`, `_quarantine-*`). One Grep
   for the header markers across them is enough; open a track's own files only for the candidates the card names.
   With the parallel add-on, call `list_tracks` instead (filters `lane`, `lane_status`; `lane: done` with `lane_status: queue` shows
   the gated tracks), then `get_track` for the track you name, for `valid.next` and the freshness line. If the freshness line says
   stale or possibly stale, say so in one line before the card. The add-on is never required.
   The add-on also reports `blocked_by` (the numbers not yet `done:success`) and `ready_to_resume` for a track with dependencies: use
   them for S09 and S10. Without the add-on, work them out from `Waiting On Tracks` and `Depends On` as the table says.
4. **Read these markers**, header block only, the first one wins when a marker is repeated (and the track is damaged, S21):
   `Lane`, `Lane Status`, `Progress`, `Phase`, `Depends On`, `Waiting On Tracks`, `Waiting for reply`, `Priority`, `Part Of`, `Merge Mode`,
   `PR URL`, `Owner Action`, `Owner Action Due`, `KPI Check After`. Match lane names by meaning (a project may still say `planning` and `in-progress`: use `conductor/workflow.json`, or
   `valid.guide_lanes`), and write the project's own lane names in the card.
4b. **Today's date.** S22 and S23 compare days, so you need today's date as a UTC calendar day. Take it from the system or the freshness
   line. If you do not know it, ask the person for it; never guess. With the add-on, `list_tracks` and `get_track` report
   `overdue` and `ready_to_measure` themselves (computed in UTC); without it, compare the days yourself. Due today is not overdue.
5. **Where a finished lane goes next** is never guessed from the raw file: use `valid.next` of `get_track`, or read
   `conductor/workflow.json` with the grammar of `ops/lanes-and-statuses.md`. Use it only to say, in one clause,
   what happens when the step finishes.
6. **Git facts, read only.** For a track in `done:queue`: does a local branch for it exist (`git branch --list`), and is it an
   ancestor of the default branch (`git merge-base --is-ancestor`)? When no branch exists, does the default branch have a commit
   for it (`git log --grep` on `(track-N)`)? A commit counts only when its subject is NOT one of the connector's own state commits,
   `chore(track-N): <tool> ...` where `<tool>` is the name of one of its three write tools (the one that creates a track, the one
   that updates it and the one that appends to its conversation), as in `chore(track-12): <tool> index.md`: those
   record the track's files, not shipped work (a track in direct mode has only these on the default branch until it is merged).
   For a track that is `running`: the time of the last commit that touched its folder or
   a branch named for it (`git log -1 --format=%ct -- <folder>`, `git for-each-ref`). A fact you cannot establish is not guessed:
   ask one question instead.
7. **Comments.** `conversation.md` is not committed: read it only when it exists here, and never rely on it. The committed signal
   for a reply that waits is the marker `Waiting for reply: yes`. When the file exists and its last entry is the human's
   (`> **human**:`) with no later `system` or agent entry, the track counts as waiting for a reply even if the marker says no.
8. **Stub files.** A `plan.md` is a stub when the file is missing (a track made by hand holds only its `index.md`), or contains the
   placeholder "Plan to be written in the plan lane", or has no checkbox. A `test.md` is a stub when the file is missing, or contains
   "(Test cases to be added)", or has no test case line. A file with real content (phases, checkbox tasks, `TC-` lines, with or
   without ticks and prose) is NOT a stub: look for the checkbox and the `TC-` line, not for completeness.
9. **A project summary** (`conductor/tracks-summary.md`) may preselect tracks in a very large project (about 100 tracks or more),
   but every track the card names is confirmed from its own `index.md`. Its "Needs attention" list is a lint list, not advice.

## States

Each row is one state: what the files show, what the card says and the command. Tracks in `backlog`, tracks in `done:success` and
archived folders are never candidates, except in S19 and S20. A track that waits on an unshipped track (S10) is never the step,
whatever its lane. An epic (a track that other tracks name with `**Part Of**`) is not a candidate either: its children are. Add one
line to the card for an epic that has unfinished children ("Epic N: 3 of 8 children done"), counted from the children's own markers;
the epic's own file holds no child status.

| Id | The project shows | The card names | Command |
|----|-------------------|----------------|---------|
| S01 | The folder is not a git repository | Setup, which offers `git init` first (explain level: also the three paths of S02) | `/laneconductor:setup` |
| S02 | A repository (or any folder with files) with no `conductor/` folder | The front door. Default level: the first card (see "The first card"). Explain level: three paths. (a) Continue this project: `setup` reads the stack, asks only to confirm, writes the `conductor/` files, never overwrites. (b) Start a new project: a short interview, then the scaffold and a first track. (c) Look around: four sentences on what LaneConductor is (the plan-first process, tracks as files in git, five lanes, nothing to install but this plugin) and the list from `help`; nothing is written. A repository with history defaults to (a); an empty folder defaults to (b). Then the add-ons and the board (see "The front door") | `/laneconductor:setup`, `/laneconductor:new-project`, `/laneconductor:help` |
| S03 | `conductor/` exists but `workflow.json` or `tracks/` is missing | Finish the scaffold: setup again, it skips what exists. Explain level: then the add-ons and the board (see "The front door") | `/laneconductor:setup` |
| S04 | Set up, and no track folder under `conductor/tracks/` | Create the first track, with an example phrase built from the project's name or README ("new track: something this project needs"). Explain level: then the add-ons and the board (see "The front door") | `/laneconductor:new <title>` |
| S05 | A track (with no `Owner Action`, see S22) waits for a human reply: `Waiting for reply: yes`, or `Lane Status: waiting` with no `Waiting On Tracks` and no unmet `Depends On` (a question or an approval), or the last comment is the human's and unanswered | Answer it: show the last comment in two lines, say what the track needs, offer the answer path (a comment, then resume with `move`) | `/laneconductor:comment N <your answer>` |
| S06 | A track is in `failure` in its lane (`implement:failure`, `plan:failure`, `quality-gate:failure`) or is `done:failure` (a merge that failed) | Look at it first: read its last comment, then choose between a retry and a replan; offer both and recommend one from the lane (implement failure: retry implement; plan failure, review failure and quality-gate failure: replan; done failure: fix the cause, then merge again) | `/laneconductor:implement N`, `/laneconductor:plan N` or `/laneconductor:merge N` |
| S07 | A track is `running` and looks abandoned: the last commit on its folder or branch is older than 6 hours | Ask, do not decide: "N has said it is running for H hours with no commit; is something still working on it?" If the answer is no, resume by setting `Lane Status` back to `queue`, then run the lane again | `/laneconductor:move N <lane>:queue` |
| S08 | A track is `running` and recent | Say so and leave it alone ("N is being worked on; start nothing on it"); the card goes on to the next candidate | none |
| S09 | `waiting` on tracks (`Waiting On Tracks`, else `Depends On`) and every named track is `done:success` | Resume it: the dependencies shipped; say which. Setting `queue` and clearing the parking markers is the resume; run the lane after | `/laneconductor:move N <lane>:queue` |
| S10 | The track names tracks it waits on (`Waiting On Tracks`, else `Depends On`) and at least one is not `done:success`, and it is `waiting` or `queue` (a `queue` track included: blocked is never the step, whatever the status; a track that is `running`, in `failure` or waiting for a reply is read as S05 to S08 first). `done:queue` is gated, not shipped, and does not count | Not a candidate. Named in the "also" line as blocked by those tracks; if the blocker is itself a candidate, it is ranked as usual | none |
| S11 | `done:queue` and the track's branch is not merged (or that cannot be established) | Merge it: it passed the quality gate and is not shipped. The merge command asks before any merge or push | `/laneconductor:merge N` |
| S12 | `done:queue` and its branch exists and is already an ancestor of the default branch, or no branch exists and the default branch has a commit for it that is not one of the connector's own state commits (`chore(track-N): <tool> ...`, see step 6) | It looks merged: ask the person to confirm, then record it | `/laneconductor:move N done:success` |
| S13 | `done:waiting` (a pull request is open) | The pull request waits for a person to merge it: show `PR URL`; once it is merged, record it | `/laneconductor:move N done:success` |
| S14 | `quality-gate:queue`, or `review:success` when the workflow does not move on by itself | Run the quality gate: it evaluates and never fixes | `/laneconductor:quality-gate N` |
| S15 | `review:queue`, or `implement:success` when the workflow does not move on by itself | Review the implementation: it evaluates and never fixes. When the parallel add-on is installed, recommend one sub-agent per track in its own worktree | `/laneconductor:review N` |
| S16 | `implement:queue`, or `plan:success` (plan done, parked) with a real plan and real test cases | Implement it from its plan. When the parallel add-on is installed, recommend one sub-agent per track in its own worktree (isolation, parallel tracks, no collisions); without it, in this session or by hand in a worktree | `/laneconductor:implement N` |
| S17 | `implement:queue` or `plan:success`, but `plan.md` or `test.md` is missing or still the empty stub from track creation | Plan it first: there is nothing to implement from. This overrides S16 | `/laneconductor:plan N` |
| S18 | `plan:queue` | Plan it: the plan lane writes the spec, the plan and the test cases, and no code; plan before code so the work is agreed and testable first | `/laneconductor:plan N` |
| S19 | The only tracks that are not shipped are in `backlog` | Pick one to start: show up to three, recommend the oldest, and say that moving it to `plan:queue` starts it | `/laneconductor:move N plan:queue` |
| S20 | Every track is `done:success`, or none is ready | Nothing waits. Offer `new` for something new, `board` to look at the whole project, `status` for the list | `/laneconductor:new <title>` |
| S21 | A track's markers cannot be read: a repeated `Lane` block, no `Lane`, a lane or status that is not in the workflow, two folders with one number | Name each such track and the fault in one line each, read it by its first marker, never rank it above a readable track; if every candidate is unreadable, the step is to fix the first one by hand | none (or `status`) |
| S22 | `Lane Status: waiting` (also `done:waiting`) with an `Owner Action`: a step only the person can do (post, record, approve, submit). Read before S05, even when `Waiting for reply` is yes or a dependency is unmet | Do the owner action: quote it, say its `Owner Action Due` day (`overdue since <day>`, `due today`, or `no due date` when it is missing or not a real `YYYY-MM-DD`) and point to the `## Draft` section of `spec.md` for the kit. The agent posts, sends and spends nothing for the person. When it is done, the person comments and the agent clears both owner markers and starts the run window | `/laneconductor:comment N <what you did>` |
| S23 | `Lane Status: waiting` with no `Owner Action`, no reply asked for and no unmet dependency, and `KPI Check After` is today or earlier (a `YYYY-MM-DD` day, or a UTC timestamp not later than now) | Measure the KPI: the run window ended. The quality gate reads the KPI from its source or asks for the number, and never invents one | `/laneconductor:quality-gate N` |

In the commands, `N` is the track number. A shell command (an install command) goes alone in its own
bash block; a slash command is inline code, in the form the person's client uses (`/laneconductor:plan N` in Claude Code; the
prompt `plan` elsewhere).

## Rank

Apply to the readable candidates of S05 to S19 and S22 and S23, first difference wins:

1. **Human reply.** An owner action (S22) comes first: oldest due first (an overdue one is simply the oldest), a missing or malformed due date last. Then a track that waits for an answer (S05). Both come before everything else.
2. **Failed or stuck.** A failure (S06) or a claim that looks abandoned (S07).
3. **Ready to resume.** A parked track whose dependencies shipped (S09), or whose run window ended (S23).
4. **Priority.** The optional marker `Priority` (`high`, `normal`, `low`; absent means `normal`): high before normal before low.
5. **Lane order, latest lane first.** `done:queue` (merge), then quality-gate, review, implement, plan. Nearly shipped work comes before work not begun.
6. **Number.** Lowest track number first (the oldest request first).

With more than two tracks in S22, add one line after the card: "You have N open owner actions: finish one before starting another." It is advice: it never changes the order or blocks anything.

A `running` track (S08) and a blocked one (S10) are skipped and named in the "also" line. When several tracks tie at the top, name
the first and list the rest in one line. When you chose between several, say the rule in one sentence ("I picked this one because
a human reply comes first").

With a track number as the argument ("what's next for N"), give the same card restricted to that track.

## The card

Always: the step with its command; one sentence on what it will do (and, in one clause, where the track goes when it
finishes); one sentence on why it comes next; the other candidates in one line (none: left out); one pointer to the lane statuses and transitions, in words (never a file path); and the closing offer "Say go and I will run it here", except when the command asks for confirmation itself (`setup`, `new-project`, `merge`, `deploy`): the card then ends with the command, so the person confirms once. The card never names a
track number outside the track it is about, and never mentions work that does not exist yet.

The explain form of the card (the step, then what and why in full):

> **Next: plan track N, "<title>".** Run `/laneconductor:plan N`.
> **What it does:** the plan lane writes the spec, the plan and the test cases for this track, and no code; when it finishes
> the track waits at `plan:success`.
> **Why now:** nothing is built before the work is agreed and testable, and this is the oldest track still waiting.
> Also waiting: N2 (implement), N3 (review). More on the lanes: `/laneconductor:workflow` shows the lane statuses and where each lane sends a track. Say go and I will run it here.

## The first card

In S01 to S04 nothing is ranked. At the default level the card is these three lines and nothing else:

> **Next: set this project up.** `/laneconductor:setup`
> It reads this project's stack and commands, then writes the `conductor/` files after your ok.
> More (the lanes, the other paths, the board and the add-ons): `/laneconductor:next explain`.

The step is the table's default (S02: `setup`, or `new-project` for an empty folder). No why line, no primer, no paths, no board or add-ons note, no "Say go". Add a line only for something to act on: a stale project-level skill (see below) or a stale freshness line.

## Levels

There are three levels: `auto` (the default), `explain` and `short`.

- `explain` adds a primer in plain words, then the card (in S01 to S04: the full text of the table row, then the front door). At most twelve lines, not repeated in the same session:
  - There are five lanes: plan, implement, review, quality-gate, done. Each track sits in one lane.
  - Plan writes the documents (spec, plan, test cases). Implement builds from the plan. Review and quality-gate judge the work and
    never fix it. Done merges it.
  - There are five statuses: `queue` (waiting to start), `running` (someone is on it), `success`, `failure`, `waiting` (parked for a
    reply or for other tracks).
  - `done:queue` means gated but not merged yet; `done:success` means it is in the main branch.
  - A marker is a bold line at the top of a track's `index.md` (`**Lane**: plan`); it is the track's state, kept in git.
  - The order is plan, implement, review, quality-gate, merge, so each step has something agreed to check against.
- `short` is the one-line card: the step, the command, a six-word why and the other candidates ("**Next: plan track N.** `/laneconductor:plan N`, the oldest request waiting. Also: N2, N3."). In S01 to S04 it is the first card.
- `auto` is stateless: it behaves as `short` in S01 to S04 (the first card, with its pointer to `next explain`), as `explain` whenever the project is young, meaning fewer than three tracks are
  in review, quality-gate or done, and as `short` otherwise.

`next explain` and `next short` (or the same words said aloud) set the level for that answer whatever the setting says. The saved level is read from `next.level` in the optional personal settings file `.laneconductor.json`; a missing file, an unreadable file or an unknown value means `auto`, with no message (one line when
the file is not valid JSON).

If the person asks to keep a level ("always short", "keep explaining"), ask before writing. If `.laneconductor.json` does not
exist, say you will create it holding only `next.level` and add the line `.laneconductor.json` to `.gitignore` (it is personal);
do both only after a yes, and keep every other key of an existing file. On no, write nothing. Nothing else is ever stored.

## The front door

At the explain level in S02, S03 and S04 the card is followed, once per session, by the optional add-ons that fit this
project and are not installed. Show them; never run an install. An add-on that is installed (the board has one more sentence, below), already offered in this session (by setup, for example) or declined is not offered. At the default level, and in later runs with tracks, add-ons are not offered on the card: they come up when the person asks for parallel work, a board or a worktree. Detect an installed add-on from the skills list and the tools you have; only if that is not enough, run `claude plugin list` (read only) as a command of its own, never chained with other commands (a chained command makes the client ask for permission); if you still cannot tell and the person says it is installed already, take their word.

The board is the one add-on that is also named when it is installed. At the explain level in S02, S03 and S04 add one sentence, once: `/laneconductor:board` opens the whole project as a board, and its What's next button shows the same step as `/laneconductor:next`. The loop: open the board, copy the step, run it here, refresh.

After the project is read, offer a STARTER SET: say which optional plugins would help THIS project, three or four at most, once. Look at what you read (the stack from `package.json`, the marker files and `conductor/tech-stack.md`, the git history, the CI files, what the person told you and the Type of the tracks) and pick only the entries below that fit and are not installed; say for each, in one short paragraph, why it fits.
Order them: the core process skills first, a design skill when the project has a UI, the stack's pack, then the rest. Never more than four. If one is already installed, say
nothing about it. If nothing fits, say nothing and go on. End the offer with: "Install them now, or I will offer each one when it comes up (when you plan a screen, deploy, and so on)."
If the person says later, record nothing: each item is offered again at its own moment, as `/laneconductor:suggest-skills` describes.

How to offer: show an entry's install commands, each alone in its own bash block (no leading `$`), then the reload step (`/reload-plugins`), and say plainly what it installs. You only show them: never run an install command yourself, and install nothing unless the person says yes (and then still show the commands for them to run). Mention each plugin once in this session; if the person declines, do not bring it up again. Detect what is installed from the session's skills list and `claude plugin list`; if you still cannot tell and the person says it is installed, take their word.

- `laneconductor-parallel`: parallel work: sub-agents per track in worktrees, conflict-checked track writes. Installs an MCP server (a Node.js program) and a scaffold script. It counts as installed when its connector tools are among your tools, or its agent `laneconductor-parallel:track-runner` is listed. Mention only when several sessions, people or sub-agents write the same tracks, or overwrites are a worry. `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-parallel@laneconductor` It fits when the git history shows several authors, the project has CI files or several services, or the person wants tracks worked in parallel or by sub-agents.
- `laneconductor-board` (Type dev/marketing/sales/support): the board: one private page of every track by lane. Installs a script (a Node.js program, no packages) and its page. It has no tool or agent to look for, and finding its files means searching the plugin install folder, which is outside the project and not read here: offer it as an option, once, and say it can be ignored if it is already installed. Mention only when the person asks for a board or dashboard (`/laneconductor:board`, `/laneconductor:board refresh`). `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-board@laneconductor` It fits when a team will follow the tracks, the project already has more than a handful of them, or the person wants an overview of every track by lane.

When BOTH add-ons (`laneconductor-parallel` and `laneconductor-board`) are missing and you offer both, also show "Both add-ons in one line:" and this block, then the reload step. When only one of them is missing, keep its offer above and add nothing. You only show it, never run an install command yourself, and install nothing unless the person says yes. It is for use inside this session, where the base is already installed.

Both add-ons in one line:

```bash
claude plugin marketplace add meller/laneconductor && claude plugin install laneconductor-board@laneconductor && claude plugin install laneconductor-parallel@laneconductor
```

## A skill tip

After a ranked card (not the first card), add at most ONE line, once per session, when a skill that fits the step's lane and the track's `**Type**` is not installed: "Tip: `<skill>` (<one clause on why>) is not installed; `/laneconductor:suggest-skills` shows how." Look first (the skills list, `claude plugin list`, `.claude/skills/`, `~/.claude/skills/`; an older name counts). Say nothing when nothing is missing or the person declined it (the file `skill-advisor-declined.txt` in the directory `git rev-parse --git-common-dir` prints), and never show a command here.

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

The plugin supplies the skill itself. A copy or a link at `.claude/skills/laneconductor` in the project is left over from an older
install (often a link into the home directory, sometimes committed, so broken for clones) and is out of date.
Look read only: Glob `.claude/skills/laneconductor`, `test -L .claude/skills/laneconductor` for a link, and
`git ls-files .claude/skills/laneconductor` to see whether git tracks it.

If it exists, say so in one sentence: "This project has its own copy of the LaneConductor skill (`.claude/skills/laneconductor`);
the plugin already supplies it, so the copy is stale." Say it after the card (one extra line in later runs). Offer its removal and
show the exact command alone in its own bash block; never run it. For a link that git does not track:

```bash
rm .claude/skills/laneconductor
```

For a folder that git does not track, `rm -r .claude/skills/laneconductor`. For one that git tracks, `git rm .claude/skills/laneconductor`
(`git rm -r` for a folder); say that removing it then needs a commit, and ask before making one.

## Rules

- Read only. Ask before writing. Never push. Never run an install command: show it.
- One step: a command the person can type, never a vague direction.
- The marker lines of a track are never edited by `next`, including a `running` claim that looks abandoned: ask, then let the
  person decide.
- Never state a fact you could not establish. A count (commits, tracks, files) comes from a command or a read run for that purpose, never from a truncated listing; if you did not run one, say no number.


## Reference: lanes, statuses and transitions

From `ops/lanes-and-statuses.md`; the whole reference you need for the card.

### The five lane statuses

| Status | Meaning |
|--------|---------|
| `queue` | Waiting for the lane's action to start (or to be picked up). A track that just moved into a lane is `queue`. |
| `running` | An agent is executing this lane's action **right now**. |
| `success` | The lane's action finished well, and the track rests here (for example `plan:success`: the plan is written and parked). |
| `failure` | The lane's action failed or could not finish; a person or a retry decides next. |
| `waiting` | Parked on purpose until a human (or a named track) acts: a question, an approval, a dependency. |

**`running` belongs to the lane whose action is executing.** It is never used for work that belongs to another lane. A deploy
gate (the full suites, then the deploy) is `quality-gate:running`, not `implement:running` and not `in-progress:running`.

### The two meanings of `done`

- `done:queue`: the track passed the quality gate. It is **not shipped**.
- `done:success`: shipped, the merge action finished (the code is reachable from `main`, or the PR is merged).

Only the quality gate moves a track to `done`. Nothing moves a track to `done:success` straight after implementing.

The other two statuses in the done lane are work somebody still has to finish: `done:failure` is a merge that failed, `done:waiting` is a
pull request that is open. Only `done:success` is quiet. With the connector, `list_tracks` hides only `done:success` unless
`include_done` is set, and adds `merged` to a done track whose `track-NNN` branch exists (true when the state branch contains it; no field
when there is no such branch, because the files cannot tell merged-and-deleted from never branched). The board lists `done:queue`,
`done:failure` and `done:waiting` under Needs attention, each with its reason.

### Transitions

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

In Claude Code, type it as `/laneconductor:next`; the commands in the card are written in that form.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__list_tracks`, `mcp__plugin_laneconductor-parallel_lc__get_track`), use them to read: they report how fresh the state is. This command writes nothing. If they are not present, the steps above are the whole job.
