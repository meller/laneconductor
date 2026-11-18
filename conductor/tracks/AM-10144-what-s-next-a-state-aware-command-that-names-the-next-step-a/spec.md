# Spec: What's next: a state-aware command that names the next step and explains it (onboarding as a tutorial)

## Problem Statement

Owner idea (2026-11-18): a command, `/laneconductor:next` ("what's next"), that looks at where the project stands and tells the user the single next step, and explains what that step does and why, so using it doubles as an online tutorial and as onboarding. Today `help` lists commands but does not know the project's state, and a new user does not know whether to run setup, plan a track or implement one.

Two owner statements govern this spec (both 2026-11-18):

1. "This is a general thing. Whenever the user is not sure how to continue, the answer is `use laneconductor next`. So it is the universal fallback and entry point, not one command among many." Everything below follows from that: `next` is read only, it works in every project state including no project at all, and every other place that could leave a person stuck (help, the end of setup, the end of a lane, the session-start status) points to it.
2. The journey is: install the base plugin, type `/laneconductor:next`, and keep progressing. `next` is the front door. In a project with no `conductor/` folder it offers three paths (continue an existing project, start a new project, or just look around). At the very start (first run, no tracks yet) it recommends the add-ons that fit, `laneconductor-parallel` and `laneconductor-board`, each install command alone in its own bash fence, shown and never run, reusing the setup recommendation block and the one catalog `connector/plugin-extras/recommended-plugins.json`, and saying nothing about an add-on that is already installed. Later runs just name the next step. The same wording must be reusable for the website's "install, run next, progress" story (the landing page is another track, AM-10125; this track only provides the text).

What it does, in one paragraph: it reads the project's own files (and git, read only), decides which state the project is in, ranks the candidate tracks with one fixed rule, and prints one card: the single next step with the exact command to type, one sentence on what it will do, one on why it comes next, the other candidates in one line, and one link to the reference. It starts nothing, claims nothing and changes no marker. If the person answers "go", the named command runs as if they had typed it.

## The need

A person who installs the base plugin sees a list of 20-odd commands and no hint where to start. Someone who comes back after a week does not remember which tracks wait for them. A person who is stuck (a track parked for a reply, a claim that never finished, a gated track nobody merged) has no single place that says "this one first". `status` lists everything; it does not choose and it does not teach. The lane model (plan, implement, review, quality-gate, done; five statuses) is learned today by reading `ops/lanes-and-statuses.md`, which nobody opens first.

## Who it is for

- A first-time user in an empty folder, in an existing codebase, or in a project that already has the `conductor/` folder from someone else.
- A returning user or a teammate who needs the one thing to do now.
- A person who answered "I do not know" to any question the plugin asked: the universal fallback.
- The website reader who wants to see the whole journey in three lines.

## Wanted outcome

One command, `next`, that in every project state names exactly one next step, says why in plain words, shows the exact command, and teaches the model a little at a time. It works from files alone in the Markdown-only base and gets better, not different, with the connector.

## Requirements

### The command

- REQ-1: `next` is a catalog command (`connector/src/commands.mjs`), so the base, the parallel add-on's prompts and `help` all list it. Name `next`; group `start here` (a new first group holding `next` and `help`, decision D1); one optional argument `option` with hint `explain | short | track number`; example phrase "what's next". The procedure is the new skill file `ops/next.md`; the catalog text stays a short pointer, like `plan` and `setup`.
- REQ-2: Read only. It never claims a track, never writes a marker, never creates a file, never installs, never pushes. The one write it may do is the personal level setting (REQ-23), only when the person asks for it and after asking.
- REQ-3: It names exactly one step. Other candidates appear in one line (at most three, then "and N more"). A step is a command the person can type, in the form their client uses (`/laneconductor:plan 10144` in Claude Code; the prompt `plan` elsewhere). A shell command (for example an install command) goes alone in its own bash fence; a slash command is inline code.
- REQ-4: It works with the argument `<track number>`: the same card restricted to that track ("what's next for 10106"). `explain` and `short` set the level for this answer (REQ-22).
- REQ-5: The card always has: the step with its command; one sentence on what the command will do; one sentence on why it comes next; the other candidates in one line (omitted when there are none); one link to `ops/lanes-and-statuses.md`; and the closing offer ("Say go to run it here"). The short level keeps only the step, the command, a six-word why and the other candidates.

### How it reads state

- REQ-6: Base (Markdown only, no tool but Read, Glob, Grep and read-only git): Glob `conductor/tracks/*/index.md`, skipping archived folders (`_duplicate-*`, `_quarantine-*`); one Grep for the header markers across those files; open a track's own files only for the candidates it will name. For a project with a committed `conductor/tracks-summary.md` and more than about 100 tracks, the summary may preselect the tracks that are not `done:success`, but every track the card names is confirmed from its own `index.md` first (the summary can be stale, and its "Needs attention" list is a lint list, not advice, and is never quoted).
- REQ-7: Markers read per track, header block only, first occurrence wins when a marker is repeated (and the track is reported as damaged, S21): `Lane`, `Lane Status`, `Progress`, `Phase`, `Depends On`, `Waiting On Tracks`, `Waiting for reply`, `Priority`, `Merge Mode`, `PR URL`. Lane names are matched by meaning for a project that still uses `planning` and `in-progress` (`valid.guide_lanes` when the connector is present, `conductor/workflow.json` otherwise); the card writes the project's own lane names.
- REQ-8: Where a finished lane goes next is never worked out from the raw file: with the connector, `valid.next` of `get_track`; without it, `conductor/workflow.json` read with the grammar of `ops/lanes-and-statuses.md`. `next` uses this only to say what will happen when the step finishes (one clause in the "what it does" sentence), never to move a track.
- REQ-9: With the connector present: use `list_tracks` (filters `lane`, `lane_status`; `lane: done` with `lane_status: queue` for the gated tracks, which shows them today) instead of reading every index, then `get_track` for the named track for `valid.next` and the provenance line. If the provenance says stale or possibly stale, say so in one line before the card. The ranking rule and the states are the same in both modes: one procedure, two ways to gather. The connector is never required.
- REQ-10: Git facts (read only): whether the folder is a repository; the current branch; for a track in `done:queue`, whether a local branch for it exists and whether it is an ancestor of the default branch (`git branch --list`, `git merge-base --is-ancestor`); for a track in `running`, the time of the last commit that touched its folder or a branch named for it (`git log -1 --format=%ct -- <folder>`, `git for-each-ref`). A fact that cannot be established is not guessed: the card asks one question instead.
- REQ-11: `conversation.md` is not committed (it is ignored in git), so it is read when it exists on this machine and never relied on: the committed signal for a waiting human reply is the marker `**Waiting for reply**: yes`. When the file exists and its last entry is from the human (`> **human**:`) with no later `system` or agent entry, the track counts as waiting for a reply even if the marker says no.

### The states

One table (the state table below) is the whole behaviour; `ops/next.md` carries it with the same ids, and the tests check the ids. Each row is a state, what the files must show, what the card says, and the command.

| Id | The project shows | The card names | Command |
|----|-------------------|----------------|---------|
| S01 | The folder is not a git repository | Setup, which offers `git init` first; the three paths of S02 | `/laneconductor:setup` |
| S02 | A repository (or any folder with files) with no `conductor/` folder | The front door: three paths. (a) Continue this project: set LaneConductor up around the code that is here (`setup`: it reads the stack, asks only to confirm, writes the `conductor/` files, never overwrites). (b) Start a new project (`new-project`: a short interview, then the scaffold and a first track). (c) Look around: what LaneConductor is in four sentences, the `help` list, nothing written. A repository with history defaults to (a); an empty folder defaults to (b). Then the add-on recommendations (REQ-14) | `/laneconductor:setup`, `/laneconductor:new-project`, `/laneconductor:help` |
| S03 | `conductor/` exists but `workflow.json` or `tracks/` is missing | Finish the scaffold: setup again, it skips what exists. Then the add-on recommendations (REQ-14) | `/laneconductor:setup` |
| S04 | Set up, and no track folder under `conductor/tracks/` | Create the first track, with an example phrase built from the project's name or README ("new track: <something this project needs>"). Then the add-on recommendations (REQ-14) | `/laneconductor:new <title>` |
| S05 | A track waits for a human reply: `Waiting for reply: yes`, or `Lane Status: waiting` with no `Waiting On Tracks` and no unmet `Depends On` (a question or an approval), or the last comment is the human's and unanswered (REQ-11) | Answer it: print the last comment in two lines, say what the track needs, and offer the answer path (`comment`, then resume with `move`) | `/laneconductor:comment N <your answer>` |
| S06 | A track is in `failure` in its lane (`implement:failure`, `plan:failure`, `quality-gate:failure`) or `done:failure` (a merge that failed) | Look at it first: read its last comment, then decide between a retry and a replan; the card offers both and recommends one from the lane (implement failure: retry implement; quality-gate failure: replan; done failure: fix the cause, then merge again) | `/laneconductor:implement N`, `plan N` or `merge N` |
| S07 | A track is `running` and looks abandoned: the last commit on its folder or branch is older than the stale threshold (REQ-17) | Ask, do not decide: "N has said it is running for H hours with no commit; is something still working on it?" If the person says no, resume by setting `Lane Status` back to `queue` and run the lane again | `/laneconductor:move N <lane>:queue` |
| S08 | A track is `running` and recent | Say so and leave it alone ("N is being worked on; start nothing on it"); the card goes on to the next candidate | none |
| S09 | `waiting` on tracks (`Waiting On Tracks`, else `Depends On`) and every named track is `done:success` | Resume it: the dependencies shipped. Say which ones. Setting `queue` and clearing the parking markers is the resume; run the lane after | `/laneconductor:move N <lane>:queue` |
| S10 | `waiting` on tracks and at least one named track is not `done:success` (`done:queue` is gated, not shipped, and does not count) | Not a candidate. Named in the "also" line as blocked by those tracks; if the blocker is itself a candidate, it is ranked as usual | none |
| S11 | `done:queue` and the track's branch is not merged (or the merge state cannot be established) | Merge it: it passed the quality gate and is not shipped. It asks before any merge or push | `/laneconductor:merge N` |
| S12 | `done:queue` and its branch exists and is already an ancestor of the default branch, or no branch exists and the default branch has commits for it (`(track-N)` in the subject) | It looks merged: ask the person to confirm, then record it | `/laneconductor:move N done:success` |
| S13 | `done:waiting` (a pull request is open) | The pull request waits for a merge by a person: show `PR URL`, and when it is merged, record it | `/laneconductor:move N done:success` |
| S14 | `quality-gate:queue`, or `review:success` when the workflow does not move on by itself | Run the quality gate: it evaluates and never fixes | `/laneconductor:quality-gate N` |
| S15 | `review:queue`, or `implement:success` when the workflow does not move on by itself | Review the implementation: it evaluates and never fixes. With the parallel add-on installed, it recommends one sub-agent per track in its own worktree | `/laneconductor:review N` |
| S16 | `implement:queue`, or `plan:success` (planned and parked) with a real plan (REQ-18) | Implement it from its plan. With the parallel add-on installed it recommends one sub-agent per track in its own worktree (isolation, parallel tracks, no collisions); without it, in this session or by hand in a worktree | `/laneconductor:implement N` |
| S17 | `implement:queue` or `plan:success`, but `plan.md` or `test.md` is still the empty stub from track creation | Plan it first: there is nothing to implement from | `/laneconductor:plan N` |
| S18 | `plan:queue` | Plan it: the plan lane writes the spec, the plan and the test cases, and no code; plan before code so the work is agreed and testable first | `/laneconductor:plan N` |
| S19 | The only tracks that are not shipped are in `backlog` | Pick one to start: show up to three, recommend the oldest, and say that `move N plan:queue` starts it | `/laneconductor:move N plan:queue` |
| S20 | Every track is `done:success` (or there are none ready) | Nothing waits. Offer: `new` for something new, `board` to look at the whole project, `status` for the list | `/laneconductor:new <title>` |
| S21 | A track's markers cannot be read (a repeated `Lane` block, no `Lane`, a lane or status that is not in the workflow, two folders with one number) | Name each such track and the fault in one line each, read it by the first marker, never rank it above a readable track; if every candidate is unreadable, the step is to fix the first one by hand | none (or `status`) |

- REQ-12: A track with a stub in plan or test (S17) overrides S16: the lane says implement, the files say there is nothing to implement from; the card says so and sends the person to plan.
- REQ-13: Tracks in `backlog`, tracks in `done:success` and archived folders are never candidates, except S19 and S20 when nothing else exists. A track whose `Depends On` names an unshipped track (S10) is never the step, whatever its lane; it is named as blocked.

### The front door and the add-ons (owner statement 2)

- REQ-14: In S02, S03 and S04 (nothing to rank yet) the card is followed, once per session, by the add-ons that fit this project and are not installed: `laneconductor-parallel` (parallel execution per plan: each track in its own worktree, conflict-checked writes) and `laneconductor-board` (the dashboard artifact), each with its two install commands, every command alone in its own bash fence, then the reload step. The text is the setup recommendation block, generated from the catalog `connector/plugin-extras/recommended-plugins.json` by `scripts/plugin-texts.mjs` into `ops/next.md` at the same marker `<!-- generated: recommended plugins -->` that setup uses (a new entry in `skillEdits()`); no sentence about an add-on is written by hand in `ops/next.md`. An add-on whose `detect` rule says it is installed is not mentioned at all. An add-on already offered in this session (by setup, for example) or declined is not offered again. Nothing is installed or run: the person runs the commands.
- REQ-15: Later runs (any state with tracks) never recommend add-ons on their own. The two exceptions are the existing trigger rules of the catalog (the person asks for parallel work, a board, a worktree), which `next` honours by pointing at the same texts.
- REQ-16: The three paths of S02 are one short message, in this order, with the default marked, and each path names its command. "Look around" prints what LaneConductor is and the list from `help`, writes nothing, and ends by saying that `next` can be run again at any time.

### Ranking

- REQ-17: Stale threshold: a `running` track whose last commit (folder or branch) is older than 6 hours (decision D3) is S07, not S08. It is a question, never a verdict, and `next` never changes the marker by itself.
- REQ-18: Stub detection: `plan.md` is a stub when it contains the creation placeholder ("Plan to be written in the plan lane") or no checkbox; `test.md` is a stub when it contains "(Test cases to be added)" or no test case line.
- REQ-19: Ranking, applied to the readable candidates of S05 to S19, first difference wins:
  1. A human reply waits (S05).
  2. Something failed or looks stuck (S06, S07).
  3. Ready to resume (S09).
  4. `Priority` (optional marker `high`, `normal`, `low`; absent means `normal`; decision D8): high before normal before low.
  5. Lane order, latest lane first: `done:queue` (merge), then quality-gate, review, implement, plan. The reason: finishing work that is nearly shipped before starting work that has not begun, so nothing sits gated or unreviewed.
  6. Track number, lowest first (the oldest request first).
  A `running` track (S08) and a blocked one (S10) are skipped and named in the "also" line. `next` states the rule in one sentence when it chose between several ("I picked this one because a human reply comes first").
- REQ-20: When several tracks share the top rank, name the first and list the rest in one line, so the person can say "the other one".

### Levels and the tutorial

- REQ-21: The explain level adds, once per answer, a short primer written in plain words: the five lanes in one line each, the five statuses in one line, `done:queue` versus `done:success`, what a marker is and where it lives (the header of `index.md`), and why work goes plan, implement, review, quality gate, merge in that order; then the card. It stays under about twelve lines and is not repeated in the same session. The step-specific "what" and "why" sentences are in both levels except short.
- REQ-22: Levels are `auto` (default), `explain`, `short`. `auto` is stateless: it behaves as `explain` in S01 to S04 and whenever the project has fewer than three tracks beyond the plan lane in total (a young project), and as `short` otherwise. `next explain` and `next short` set the level for that answer whatever the setting says. "Short" and "explain" said in words mean the same.
- REQ-23: A level the person asks to keep ("always short", "keep explaining") is stored under the key `next.level` (`auto`, `explain`, `short`) of the optional personal settings file `.laneconductor.json` (`ops/settings.md`, defined by track AM-10133). The file is personal and ignored by git; if it does not exist, the card asks before creating it and adds the line `.laneconductor.json` to `.gitignore` after asking, exactly as the board procedure does for its URL. Nothing else is ever stored; there is no counter file and no per-run write (decision D4).
- REQ-24: `ops/settings.md` gets one table row for `next.level` (read by the `next` command only). A missing file, an unreadable file or an unknown value means `auto`, and `next` works the same with no settings file at all.

### Closing hints elsewhere (the universal fallback)

- REQ-25: `help` opens with one line: "Not sure where to go? Use `next`: it reads this project and names the one step." (the catalog's `helpLines` intro, so the base help, the MCP prompt and the help tool all carry it).
- REQ-26: The end of `setup` and of `new-project` says "Next: run `/laneconductor:next`" in place of the free-form "the next step in one line". When setup has just offered the add-ons, `next` does not repeat them (once per session).
- REQ-27: The base `Habits` section of `SKILL.md` (`BASE_HABITS` in `scripts/plugin-texts.mjs`) changes in two lines: the session-start 3-line status ends with "say `next` for the one step"; and "When a lane finishes, offer exactly one next step" is redefined as "give the one-line card `next` would give for this track" (the S11 to S18 rows for that track), so the closing line of a lane and `next` can never disagree.
- REQ-28: Other commands do not get a footer appended to their output (decision D6). The commands `new`, `bug` and `feature` and `create_track` are not touched by this track (track AM-10143 edits them).
- REQ-29: The connector's server instructions (`connector/src/instructions.mjs`) get one sentence ("When unsure how to continue, run the `next` prompt"); they stay under 4,096 characters.
- REQ-30: The board does not show the `next` line (decision D5): the board is a published snapshot and a stale "next" is worse than none. The board keeps its needs-attention list.

### The website story

- REQ-31: One generated text block, `NEXT_JOURNEY` in `scripts/plugin-texts.mjs` (the one place of public texts), states the journey in four lines: install the base plugin (the line the README already has); type `/laneconductor:next`; follow the one step it names, again and again; what appears at the start (the three paths, the add-ons that fit, one install command per block). The base README includes it between generated markers; the landing page track (AM-10125) takes the same block. It contains no sentence about anything not yet shipped.

### Public wording

- REQ-32: Shipped text (`ops/next.md`, the command, the README block, the help line) never says "legacy" about the daemon and worker tier (when that tier has to be named in an internal file the words are "experimental, currently unmaintained"; the base names it nowhere), says nothing about backlog work or future work, names no track number and no future version, contains none of the words the base test forbids (`make install`, rc file, `worker`, `collection`, `daemon`) and no `lc` subcommand. The lane name `backlog` and the state S19 are the one allowed use of that word.

## How it works in the Markdown-only base, and what the connector adds

- Base: the whole feature is two Markdown files (`ops/next.md`, the state table and procedure; `commands/next.md`, a pointer generated from the catalog) plus a table row in `ops/settings.md`, a row in the `SKILL.md` routing table, a one-line marker note for `Priority` in the SKILL markers table and the edits of REQ-25 to REQ-27. No program is added to the base. It uses only Read, Glob, Grep and read-only git.
- Parallel add-on, when present: the same procedure, gathering through `list_tracks` (fewer files read), `valid.next` and `valid.guide_lanes` from `get_track` and `get_context` (the workflow's own answer, never recomputed), and the provenance line (freshness; unpushed commits). The catalog marks `next` read only, so the generated "use the tools" line says they are for reading and not for writes.
- No connector tool is added in the first version (decision D7). The test suite carries a small reference classifier of the state table over fixture projects; it is the oracle for the tests, not a shipped feature.

## Dependencies and the first-version scope

The feature ships without any of the audit tracks. Each is used for a stronger signal later, and until then the first version uses the plain-git heuristic below.

| Track | What it would give `next` | First version without it |
|-------|----------------------------|--------------------------|
| AM-10131 workflow transitions (merged) | `valid.next` | Used as is; without the connector, the grammar of `ops/lanes-and-statuses.md` |
| AM-10135 done-lane truth | `list_tracks` stops hiding gated tracks; an attention rule for `done:queue`, `done:failure`, `done:waiting`; a merged check | `next` asks `list_tracks` for `lane: done` explicitly, or reads the headers; it makes its own ancestor check (REQ-10) |
| AM-10136 ready to resume | `blocked_by`, `ready_to_resume`, a required Waiting Reason, parking markers cleared on resume | `next` computes blocked and ready itself from `Waiting On Tracks` and `Depends On` (S09, S10); a missing Waiting Reason makes the waiting track a human question (S05) |
| AM-10141 stale running | `Run Started` and `Run By` stamps and a stale lint | `next` uses the age of the last commit (REQ-10, REQ-17) and asks |
| AM-10139 marker parser | First-match-wins, CRLF, case; a repair write | `next` reads by the first marker itself and reports damaged tracks (S21); it does not repair anything |
| AM-10145 epic and `Part Of` | The derived epic table; epics are not candidates | An epic that sits in the plan lane is offered like any track. Known limitation; the owner can mark such a track `Priority: low` (decision D10) |
| AM-10143 create_track sees other branches | Search-first `new` | `next` points to `new` and does not depend on how it allocates numbers; this track edits the same catalog file, so it is built after 10143 merges |
| AM-10124 skill advisor | Recommended skills at the moment of intent | v1 ships nothing about it; Phase 8 adds one line to the explain level once the advisor exists |
| AM-10122 next hints in the connector envelope | A `next` field on every tool response | Not used. `next` (this command) is the single source; if 10122 is ever built its field must carry what this procedure would say |
| AM-10133 plugin-only setup (merged; its open items are README, landing, real use) | The optional settings file and its rules | Used as defined in `ops/settings.md` |

## Owner decisions, each with the default this spec uses

- D1: name and place. Default: `next`, in a new first catalog group `start here` together with `help`.
- D2: ranking order of REQ-19. Default as written (human reply, failure or stuck, ready to resume, priority, latest lane first, lowest number first).
- D3: stale threshold. Default 6 hours since the last commit on the track's folder or branch, asked as a question.
- D4: where the tutorial level lives. Default: stateless `auto` plus an explicit `next.level` in the optional personal settings file only when the person asks; no counter, no per-run write. The alternative, a run counter in the settings file ("the first three times"), writes a file nobody asked for.
- D5: does the board show the line. Default: no.
- D6: hints in other commands. Default: help, the end of setup and new-project, the session-start status and the lane-closing line only; no footer on every command.
- D7: a connector tool `next_step`. Default: no in the first version.
- D8: the `Priority` marker (`high`, `normal`, `low`). Default: documented in this track's `SKILL.md` edit and honoured by `next`; its display in `list_tracks`, the summary and the board belongs to AM-10145 (which owns the marker table work). No new track.
- D9: add-on recommendations at the front door. Default: S02, S03 and S04, once per session, only the ones that fit and are not installed.
- D10: epics before `Part Of` exists. Default: accept the limitation.
- D11: the closing offer. Default: "Say go and I will run it here"; nothing runs without that yes.
- D12: release. Default: this track does not bump the plugin version; the owner releases (patch or minor) after review.

## Acceptance criteria

All of them are things a person can see.

- [ ] AC-1: In an empty folder, `/laneconductor:next` offers the three paths with the default marked, names `/laneconductor:new-project`, and shows the add-ons that fit (each install command alone in its own bash fence) without running anything.
- [ ] AC-2: In an existing repository with no `conductor/` folder, it defaults to continuing the project (`/laneconductor:setup`) and says what setup will create and ask.
- [ ] AC-3: After setup, with no tracks, it says "create your first track" with an example phrase from this project.
- [ ] AC-4: With tracks in different states, it names the single step the ranking rule picks, in every state of the table, with the exact command, one sentence on what, one on why, and the link; the other candidates are in one line.
- [ ] AC-5: A track waiting for a human reply is named before any other work; a track whose waiting dependencies have shipped is named as ready to resume; a `done:queue` track is named for merge and the merge command asks before a push.
- [ ] AC-6: A `running` track with no recent commit is reported as possibly abandoned with a question, and no marker is changed.
- [ ] AC-7: `next explain` prints the primer; `next short` prints one line; saying "always short" and agreeing stores `next.level` in an ignored `.laneconductor.json`; a project with no settings file works the same.
- [ ] AC-8: `next` appears in `help`, in the base commands, in the parallel add-on's prompts and in the plugin map; `help` opens with the "not sure where to go" line; setup and new-project end by pointing to `next`.
- [ ] AC-9: On a scratch repository the walk-through of `test.md` runs from an empty folder to a merged track with `next` naming each step correctly.
- [ ] AC-10: The base plugin stays Markdown only, stays free of the forbidden words, names no `lc` command and nothing unshipped, and adds no program.
- [ ] AC-11: The journey text exists once and the README block and the landing track can both use it.

## Out of scope

- Any change to the `new`, `bug` and `feature` procedures or `create_track` (AM-10143, in progress).
- The audit fixes themselves (AM-10135, 10136, 10139, 10141), the `Part Of` marker and the epic table (AM-10145), the skill advisor (AM-10124). The first version does not wait for them; `next` gains their signals in Phase 8 as each one lands.
- A connector tool for `next`, a daemon or poller, running a lane by itself, pushing, and any write other than the personal level setting.
- The landing page, the wiki and the website (AM-10125); this track only provides the text block.
- A per-person setting that follows the person across projects (the settings file is per project folder).
- Public mention of anything not yet shipped.
