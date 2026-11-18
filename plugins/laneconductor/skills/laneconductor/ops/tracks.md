# Track operations

With the parallel add-on installed, use its connector tools (`create_track`, `update_track`, `append_conversation`): they refuse a write when someone edited first. The file edits below always work, with or without the add-on.

## What goes in each track file

A track is a folder of six files. Each has one job; put a thing in the file whose job it is, and keep logs out of the design files.

| File | Role | Holds | Never holds |
|------|------|-------|-------------|
| `index.md` | Overview (the project-manager view) | What and why in a few lines, the markers, one line on where the track stands | Logs, long text, status history |
| `spec.md` | Detailed design (the architect view) | Requirements, dated decisions, data model and APIs, acceptance criteria, risks | Status, release notes, incident reports |
| `plan.md` | Task tracker: the work breakdown | Phases and the individual tasks as checkboxes, as detailed as the work needs, ticked as work proceeds | Dated status, releases, incidents, a run log; design detail, decisions, requirements, acceptance criteria (they go to `spec.md`) |
| `test.md` | Test plan | Test cases and the commands that run them | Status of a run |
| `history.md` | Run log: tracked in git, append-only | One dated line per event: what ran, commit hashes, deploys, incidents | Design, decisions, dialogue |
| `conversation.md` | Dialogue between people and agents: untracked, may be private | Questions, answers, comments, a long write-up | The run log |

**Who ticks what.** The acceptance criteria in `spec.md` are ticked by the review and the quality gate, after they saw the criterion hold. The tasks in `plan.md` are ticked by the implementing agent, as it finishes them. A plan task may name the requirement it serves (`REQ-3`), so a reader can trace the plan to the spec.

**Where a status goes.** Status, a release, an incident or any other dated entry never goes into `plan.md` or `spec.md`. It is one line in `history.md`, newest last:

```
- <YYYY-MM-DD HH:MMZ> <emoji> <one line>
```

The emoji is the first character after the date: `✅` success, `⚠️` a human should look, `❌` failed, `ℹ️` a note. Put a hash, a URL or the name of a deploy in the line; put long text in `spec.md` (a decision, with its date and its reason) or `conversation.md` (a discussion) and link to it from the line. The plan only gets ticked.

With the add-on, `append_conversation` with author `system` writes that dated line into `history.md` (the answer says which file got it); the authors `human`, `claude` and `gemini` write `conversation.md`. By hand, append the line to `history.md` and commit it with the track. `create_track` makes `history.md` with a one-line header; an older track without the file gets it with its first `system` entry, or by hand.

## Splitting a plan that holds a log

A plan has become a log when two or more of its headings are dated (`## 2026-11-18`, `### 18 Nov`) or start with STATUS, RELEASE, INCIDENT, UPDATE or LOG, or when it is over 60 KB. (With the add-on, `get_track` warns with `plan_has_log`, `list_tracks` and the track summary name the tracks.) A plan with many task checkboxes is not a log: never split a plan for having many tasks.

1. **Ask first.** Say which plan, how many dated sections and how large it is, and ask "Split it now? [default: yes]". Change nothing without the answer.
2. **Dated sections go to `history.md`.** Each status, release or incident section becomes one dated line, `- <YYYY-MM-DD HH:MMZ> <emoji> <one line>`, oldest first, keeping its hashes, URLs and numbers. Use the section's own date; when it has none, use the date of the commit that added it (`git log -S`). A long section's detail is not thrown away: it stays under its line in `history.md` as indented continuation lines (two spaces), so the log stays in git.
3. **Decisions go to `spec.md`.** A design decision, a requirement or an acceptance criterion found in the plan moves to `spec.md` with its date and its reason.
4. **The plan keeps the work breakdown.** Phases and the checkbox tasks stay in `plan.md`, their ticks unchanged.
5. **Never delete.** Everything removed from the plan exists in `history.md`, `spec.md` or `conversation.md` afterwards; the old text stays in git. Commit the files together with explicit paths, and add one `history.md` line saying the plan was split.

## Search first: the default is update, not create

Before any track is created (`newTrack`, `reportaBug`, `featureRequest`, or you deciding on your own that "this needs a track"), look for one that already holds the work. Creating is the exception, never the default.

1. **Search.** List the tracks by the key words of the request, in every lane including the `backlog` and `done`. With the add-on, `list_tracks` with `include_done` and a `query` (one key word per call; repeat with two or three words). Without it, read `conductor/tracks-summary.md` (every track by lane), or the `index.md` of each folder under `conductor/tracks/` (title, lane, summary). Read the best matches.
2. **If one fits,** say so and ask: "Update track N (title, lane) with this? [default: yes]". On yes, or no answer to a default-yes question, extend that track (its `spec.md` or `plan.md`, and a comment in `conversation.md`) and create nothing. A track in `done` is reopened (moved back to a working lane) only on the person's explicit yes.
3. **If the person says no, or nothing fits,** create the track, and say which tracks you looked at and why none fit. With the add-on, `create_track` answers with `similar_tracks` (up to 5 by title and summary words, any lane) and a warning on a strong match; it never blocks, so it is a second look, not a replacement for step 1.
4. **Several small gaps in one session** go into one fitting track, an epic or one `backlog` track, not one track each.

## newTrack `[name] [description]`

Do "Search first" above, and continue here only when it ends in "create". With the add-on, call `create_track` (it takes the same fields, including the merge mode and auto run
markers). By hand:

1. **Number and author initials.** Take initials from `git config user.name` (first letter of each
   word, at most 3, `XX` if unset: "Asaf Meller" -> `AM`, "John von Neumann" -> `JVN`). Find the
   highest existing number by scanning every folder name under `conductor/tracks/`, ignoring any prefix (`10022-slug` and
   `AM-10022-slug` both give `10022`). The display ID is `INITIALS-NNN`; the folder is
   `INITIALS-NNN-slug/`.
2. **Create `conductor/tracks/INITIALS-NNN-slug/index.md` right away**, for fast feedback:
   ```markdown
   # Track INITIALS-NNN: [name]

   **Lane**: plan
   **Lane Status**: queue
   **Progress**: 0%
   **Phase**: New
   **Type**: [dev|marketing|sales|support|other]
   **Merge Mode**: direct
   **Auto Run**: yes
   **Author**: INITIALS
   **Created By**: user@email.com
   **Summary**: [description]
   ```
   `**Type**` defaults to `dev`. `**Merge Mode**` and `**Auto Run**` default to `direct` and
   `yes` (changed 2026-09-08; before that the markers were omitted and fell back to the
   conservative `pr` / not-auto-run). Write `pr` / `no` only when the user asks for it on this
   track ("this one needs a PR, don't auto-run it"). The change affects new tracks only; a track
   that already exists without the markers keeps the old fallbacks.
3. **No queue file.** The folder you just made is the track; nothing else registers it.
4. **Non-dev types.** For `marketing`, `sales` or `support`, look for the skills the Type works
   best with, and say which are installed and which are missing. A skill counts as installed when
   it is in the skills list this session shows you (that covers project, user and plugin skills),
   when `claude plugin list` shows its plugin, or when it is in `.claude/skills/` or
   `~/.claude/skills/`; an older name counts too. For each one that is installed say "you have
   `<skill>` installed, use it before writing the content". Offer only the missing ones, once, as
   below; the same offer comes again when the track is planned and implemented.

   A track whose `**Type**` is `marketing`, `sales` or `support` is written, not coded, and it is better with the matching skills in hand. Offer what is missing when the track is created, again when it is planned and when it is implemented (once per session each time it is still missing), and look first: the skills may already be installed at user level or from a plugin, not only in `.claude/skills/`.

**How to offer.** Plain text in your reply: never a form, a menu or a question that blocks the work.

1. **Look first.** A skill counts as installed when any of these is true: it is in the skills list this session shows you (that list already covers project, user and plugin skills, and a plugin skill can appear as `plugin:skill`); `claude plugin list` (read only; run it once per session, and only when the list is not enough) shows its plugin as enabled; or a folder with its name exists in `.claude/skills/` of the project or in `~/.claude/skills/`. A skill listed under an older name counts too. When it is installed, say so in one line ("you have `<skill>` installed, use it before writing the content") and use it.
2. **Offer only what is missing**, from the candidates below that fit the lane, the track's `**Type**` (`dev` when it has none) and the project's stack: read `conductor/tech-stack.md` and look for the marker files named under "Stack tags". When nothing is missing, say nothing.
3. **Be quiet.** At most two items per offer: our own entries before third-party ones, `prerequisite` before `helps`. Never the same entry twice in a session, and never an entry on the project's declined list: the file `skill-advisor-declined.txt` inside the directory that `git rev-parse --git-common-dir` prints (one entry name per line; it is inside `.git`, so it is never committed). A trivial track gets at most the one-line tip, and a suggestion in the middle of a step (a failing test and `systematic-debugging`) is one line.
4. **Say it in one or two plain sentences**: what it is, why it helps here, where it comes from, and what it installs (use the note under its name: an entry that installs a program says so plainly; a Markdown-only one adds knowledge only). Then each install command alone in its own bash block, one command per block, no leading `$`, so the desktop app shows a Run button. In a session the person can type `/plugin install <plugin>@<marketplace>` instead (inline text, not a block); that opens the plugin's details for review.
5. **Level.** `prerequisite`: say the result will be better with it and ask, in the same sentence, whether to install it first or carry on. `helps`: a one-line tip. Either way the work is not blocked: with no answer, carry on.
6. **The answer.** *Install first*: show the commands, say nothing has been changed yet, say to run them and then `/reload-plugins`, and when the person is back start the step again from the top with the skill present. *Carry on*: start the step at once and do not repeat the offer this session. *Do not ask again*: show the line you would add and, after the yes, append the entry's name to the declined file; with no git directory, just do not offer it again this session.
7. **Never run an install yourself.** The commands are shown; the person runs them, or uses the client's own plugin browser. If one fails, report the command and its output, retry nothing silently and work around nothing by editing settings or permissions. To share a plugin with collaborators, offer to add it to `enabledPlugins` in the project's `.claude/settings.json` only when the person asks: show the exact change first, say it turns the plugin on for them but does not download it (each person runs the install once with `--scope project`), and write it only after a yes.

Candidates for these Types:

#### `marketing-skills`

Marketing and sales skills for content: strategy, launch plans, copywriting, social posts, sales enablement, prospecting, cold email, analytics and A/B tests (53 skills in all). Third-party, licence MIT, from `coreyhaines31/marketingskills`. Fits `setup`, `plan`, `implement`, `quality-gate` (lanes), Type `marketing`, `sales`, any stack. Level: `prerequisite`.
Skills for this part: `content-strategy`, `launch` (older installs list it as `launch-strategy`), `copywriting`, `social` (older installs list it as `social-content`), `sales-enablement`, `cold-email`, `prospecting`, `revops`, `analytics` (older installs list it as `analytics-tracking`), `ab-testing` (older installs list it as `ab-test-setup`).
It counts as installed when a skill from it (for example `copywriting` or `cold-email`) is in the session's skills list, in `.claude/skills` or `~/.claude/skills`, or `claude plugin list` shows `marketing-skills@marketingskills`. It is Markdown only: it adds knowledge and installs no program. It comes from `coreyhaines31/marketingskills`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add coreyhaines31/marketingskills
```

```bash
claude plugin install marketing-skills@marketingskills
```

#### `customer-support`

Support skills: ticket triage, draft replies, knowledge-base articles and escalations. Third-party, licence Apache-2.0, from `anthropics/knowledge-work-plugins`. Fits `plan`, `implement` (lanes), Type `support`, any stack. Level: `helps`.
Skills for this part: `ticket-triage`, `draft-response`, `kb-article`, `customer-escalation`, `customer-research`.
It counts as installed when a skill from it (for example `ticket-triage`) is in the session's skills list, or `claude plugin list` shows `customer-support@knowledge-work-plugins`. It installs connection settings for hosted services (Slack, Intercom, HubSpot, Notion and others; no local program, each asks you to sign in before it connects), plus Markdown skills on your computer, from `anthropics/knowledge-work-plugins`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add anthropics/knowledge-work-plugins
```

```bash
claude plugin install customer-support@knowledge-work-plugins
```

5. Create `history.md` beside the other files, with one header line (`# History: Track INITIALS-NNN`) and nothing else.
6. Print `✅ Track NNN created in conductor/tracks/<folder>/.`

## move `[track-number] [lane:status]`

Moving to a lane without a status means `queue`: `move NNN backlog`, `move NNN implement:queue`
(it waits in that lane), `move NNN plan:success` (parked as done planning). Set `**Lane**` and
`**Lane Status**` in `conductor/tracks/NNN-*/index.md` (with the add-on, `update_track` with those markers).
Prefer a `lane:status` that `workflow.json` defines for that lane. When the move is "this lane's action
finished", do not work the target out yourself: with the connector, call `update_track` with `outcome`
(`success` or `failure`) and the `base` from `get_track`, which applies the workflow's move; its answer to
"where does it go" is `valid.next` in `get_track`. Without the connector, read `workflow.json` with the
grammar in [lanes-and-statuses.md](lanes-and-statuses.md) (a bare target is `queue` for another lane;
for the same lane it is `success` or `failure`).

## pulse `[track-number] [status] [progress%] [summary?]`

Update the track's markers in `conductor/tracks/NNN-*/index.md`: `**Progress**: N%`, `**Phase**`
when the work entered a new phase, `**Step**` (the current activity; infer it if not given),
`**Summary**`, and `**Waiting for reply**: no` after every AI response. A `[status]` that names a lane is a move, so use `move` for that;
`pulse` does not write `**Status**` any more (it is a legacy marker the parser only reads when
`**Lane**` is missing).

## comment `[track-number] [body]`

A comment from a person or an agent is a `> **author**: [body]` entry (format rules in SKILL.md) in
`conductor/tracks/NNN-*/conversation.md`; this is also how an agent answers a human comment. A note that records
an event (a run, a classification, a completion) is a dated line in `history.md` instead (see "What goes in each track file").
Use `⚠️` for something that needs a human and `ℹ️` for a note.

## delete `[track-number]`

A hard delete with no undo; the recommended soft alternative is `move NNN backlog`. Ask the user
to confirm first, naming the track title. Then:
1. `rm -rf conductor/tracks/NNN-*/` after the confirmation (Glob both naming forms first).
2. If a worktree exists for it, remove it: `git worktree remove .worktrees/NNN`, and the branch with `git branch -d track-NNN`.
3. Print `✅ Track NNN deleted`.

## revert `[track] [phase] [task?]`

Safe undo at track, phase or task level (the conductor `revert` behaviour). Afterwards re-parse
`plan.md`, recalculate `**Progress**` from its checkboxes, and, if a done track went back into
a phase, set the lane back to `implement`.

## status

Read `**Lane**`, `**Progress**` and
`**Phase**` from every `conductor/tracks/*/index.md` (with the add-on, `list_tracks`) and print the tracks grouped by lane.

## workflow, workflow set `[lane] [key] [value]`

What the lanes, the five lane statuses and the `on_success` / `on_failure` targets mean (and the defaults
of a bare target) is in [lanes-and-statuses.md](lanes-and-statuses.md); read that rather than guessing from
the file. A `workflow.json` that still has bare targets, `auto_action` or the old lane names (`planning`,
`in-progress`) is the older format: it works, and migrating it is only ever offered (see the command
text), never done without the person's yes.

To show the workflow, print `conductor/workflow.json` as a table (lane, auto action, on_success,
on_failure, retries, model). To set one field, edit the JSON by hand: `lanes[lane][key]`, or `global[key]` / `defaults[key]` when the lane is
`global` or `defaults`; numeric fields are integers. Examples:
```
workflow set review max_retries 3
workflow set quality-gate on_failure implement:queue
workflow set implement primary_model sonnet
workflow set global total_parallel_limit 5
```
Valid keys per lane: `parallel_limit`, `max_retries`, `primary_model`, `auto_action`,
`on_success`, `on_failure`. The lanes are `plan`, `implement`, `review`, `quality-gate`, `done`;
`on_success` / `on_failure` take a lane or a `lane:status` (`review:queue`, `plan:success`,
`backlog`, `done:queue`) or `null`. Print `✅ workflow.json updated: lanes.<lane>.<key> = <value>`.

## updateTrack, reportaBug, featureRequest

`updateTrack [id] [msg]` adds work, a bug or a feature to an existing track and returns it to backlog;
`reportaBug [desc]` and `featureRequest [desc]` each update a matching track or create a new bug / feature
track, update first: follow "Search first" above (list every lane including backlog and done, ask
"Update track N (title, lane) with this? [default: yes]", create only on a no or when nothing fits). With the add-on, `create_track` and
`update_track` do the writes; without it, append the new detail to the matching track's `conversation.md`
(or its `spec.md`) and `move NNN backlog` (a done track only on the person's yes), otherwise create one
with newTrack and set `**Track Kind**: bug` or `feature`.

A new bug or feature track is a form, not the generic skeleton. A bug `spec.md` has, after
`## Problem Statement`: `## Symptom`, `## Steps to reproduce`, `## Expected result`,
`## Actual result`, `## Suspected area`, `## Environment`, and its `test.md` starts with a
regression-test case that reproduces the bug and fails before the fix. A feature `spec.md` has
`## The need`, `## Who it is for`, `## Wanted outcome`, `## Acceptance criteria`, `## Out of scope`.
The exact text is in [setup/templates.md](../setup/templates.md) ("Track spec forms"); the
laneconductor-parallel add-on's `mcp__plugin_laneconductor-parallel_lc__create_track` with `track_kind` writes the same forms when it is present.

## init-tracks-summary

The summary file `conductor/tracks-summary.md` (counts per lane, tracks grouped by lane) is built from every
track's `index.md`. The parallel add-on regenerates it on every write; without it, write the file by hand
from the track folders whenever the summary looks stale.
