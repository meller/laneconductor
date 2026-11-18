---
description: File a feature request as a track (a feature form)
argument-hint: <the feature and why it is wanted>
---
File a feature track for: `$ARGUMENTS`. The procedure is the skill file `ops/tracks.md` (`featureRequest`).

This command carries the skill text it uses, at the end under "Reference". Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the command are references only.

1. Search first; update is the default, create is the fallback. Read `conductor/tracks-summary.md` if it exists (every track, every lane, the backlog and done too), otherwise Glob `conductor/tracks/*/index.md` and read the titles, lanes and summaries; look for the key words of the request (several words, one at a time). Read the best matches. If one fits, say so and ask me "Update track N (title, lane) with this? [default: yes]". On yes, or no answer, extend that track (its `spec.md` or `plan.md`, and a comment in `conversation.md`) and do NOT create a track; a done track is reopened only on my explicit yes. Only if I say no, or nothing fits, create the track by hand as `newTrack` describes, and say which tracks you looked at and why none fit. Several small gaps from one session go into one fitting track, an epic or one backlog track, not one track each. The track you create is made by hand as `newTrack` describes, with `**Track Kind**: feature`, a short title and the need and the wanted outcome in my words, using the feature form in `ops/tracks.md` and `setup/templates.md` (The need, Who it is for, Wanted outcome, Acceptance criteria, Out of scope).
2. Report the number and folder of the track you updated or created. Do not start planning it unless I ask.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__list_tracks`, `mcp__plugin_laneconductor-parallel_lc__update_track`, `mcp__plugin_laneconductor-parallel_lc__get_track`, `mcp__plugin_laneconductor-parallel_lc__create_track`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.

## Reference

From the skill files this command names, copied here: whole files, or only the sections the command uses.

### `ops/tracks.md` (Search first: the default is update, not create)

#### Search first: the default is update, not create

Before any track is created (`newTrack`, `reportaBug`, `featureRequest`, or you deciding on your own that "this needs a track"), look for one that already holds the work. Creating is the exception, never the default.

1. **Search.** List the tracks by the key words of the request, in every lane including the `backlog` and `done`. With the add-on, `list_tracks` with `include_done` and a `query` (one key word per call; repeat with two or three words). Without it, read `conductor/tracks-summary.md` (every track by lane), or the `index.md` of each folder under `conductor/tracks/` (title, lane, summary). Read the best matches.
2. **If one fits,** say so and ask: "Update track N (title, lane) with this? [default: yes]". On yes, or no answer to a default-yes question, extend that track (its `spec.md` or `plan.md`, and a comment in `conversation.md`) and create nothing. A track in `done` is reopened (moved back to a working lane) only on the person's explicit yes.
3. **If the person says no, or nothing fits,** create the track, and say which tracks you looked at and why none fit. With the add-on, `create_track` answers with `similar_tracks` (up to 5 by title and summary words, any lane) and a warning on a strong match; it never blocks, so it is a second look, not a replacement for step 1.
4. **Several small gaps in one session** go into one fitting track, an epic or one `backlog` track, not one track each.

### `ops/tracks.md` (newTrack; updateTrack, reportaBug, featureRequest)

#### newTrack `[name] [description]`

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

###### `marketing-skills`

Marketing and sales skills for content: strategy, launch plans, copywriting, social posts, sales enablement, prospecting, cold email, analytics and A/B tests (53 skills in all). Third-party, licence MIT, from `coreyhaines31/marketingskills`. Fits `setup`, `plan`, `implement`, `quality-gate` (lanes), Type `marketing`, `sales`, any stack. Level: `prerequisite`.
Skills for this part: `content-strategy`, `launch` (older installs list it as `launch-strategy`), `copywriting`, `social` (older installs list it as `social-content`), `sales-enablement`, `cold-email`, `prospecting`, `revops`, `analytics` (older installs list it as `analytics-tracking`), `ab-testing` (older installs list it as `ab-test-setup`).
It counts as installed when a skill from it (for example `copywriting` or `cold-email`) is in the session's skills list, in `.claude/skills` or `~/.claude/skills`, or `claude plugin list` shows `marketing-skills@marketingskills`. It is Markdown only: it adds knowledge and installs no program. It comes from `coreyhaines31/marketingskills`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add coreyhaines31/marketingskills
```

```bash
claude plugin install marketing-skills@marketingskills
```

###### `customer-support`

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

#### updateTrack, reportaBug, featureRequest

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
The exact text is in `setup/templates.md` ("Track spec forms"); the
laneconductor-parallel add-on's `mcp__plugin_laneconductor-parallel_lc__create_track` with `track_kind` writes the same forms when it is present.

### `setup/templates.md` (the track forms)

**Track spec forms** (bug and feature tracks; used by `ops/tracks.md`, and written by `mcp__plugin_laneconductor-parallel_lc__create_track` of the laneconductor-parallel add-on when it is present). A hand-made bug or feature track uses the same sections. `spec.md` starts with the title and `## Problem Statement` holding the request text unchanged; the sections below follow it in this order, each left as `(To be filled in.)` until the plan lane fills it. Set `**Track Kind**: bug` or `feature` in `index.md`. With no kind, keep the generic skeleton (`## Problem Statement`, then `## Requirements`).

```markdown
# Spec: [title]

## Problem Statement
[the problem text, unchanged]

## Symptom
## Steps to reproduce
## Expected result
## Actual result
## Suspected area
## Environment
```

A **feature** spec has `## The need`, `## Who it is for`, `## Wanted outcome`, `## Acceptance criteria`, `## Out of scope` in place of the six bug sections.

A **bug** track's `test.md` starts with a regression-test case, before any other test:

```markdown
# Tests: Track NNN - [title]

- [ ] TC-1 (regression): a test that reproduces the bug (the steps in "Steps to reproduce") and FAILS before the fix; it passes after the fix and stays in the suite
```

Any other kind (or none) keeps `(Test cases to be added)` in `test.md`.
