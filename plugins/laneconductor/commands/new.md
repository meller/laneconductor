---
description: Create a new track from a title and a problem statement
argument-hint: "<title: what and why>"
---
Create a track for: `$ARGUMENTS`. The procedure is the skill file `ops/tracks.md` (`newTrack`).

This command carries the skill text it uses, at the end under "Reference". Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the command are references only.

1. Search first; update is the default, create is the fallback. Read `conductor/tracks-summary.md` if it exists (every track, every lane, the backlog and done too), otherwise Glob `conductor/tracks/*/index.md` and read the titles, lanes and summaries; look for the key words of the title (several words, one at a time). Read the best matches. If one fits, say so and ask me "Update track N (title, lane) with this? [default: yes]". On yes, or no answer, extend that track (its `spec.md` or `plan.md`, and a comment in `conversation.md`) and do NOT create a track; a done track is reopened only on my explicit yes. Only if I say no, or nothing fits, create the track by hand as `newTrack` describes, and say which tracks you looked at and why none fit. Several small gaps from one session go into one fitting track, an epic or one backlog track, not one track each. The track you create gets its folder and files by hand as `newTrack` describes, a short title and the problem in my words (set `**Type**` only if it is not dev).
2. Report the number and folder of the track you updated or created. Do not plan it unless I ask; `plan` is the next step.

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

### `ops/tracks.md` (newTrack)

#### newTrack `[name] [description]`

Do "Search first" above, and continue here only when it ends in "create". With the add-on, call `create_track` (it takes the same fields, including the merge mode and auto run
markers). By hand, write the files exactly as it would:

1. **Number and author initials.** Take initials from `git config user.name` (first letter of each
   word, at most 3, `XX` if unset: "Asaf Meller" -> `AM`, "John von Neumann" -> `JVN`). Find the
   highest existing number by scanning every folder name under `conductor/tracks/`, ignoring any prefix (`10022-slug` and
   `AM-10022-slug` both give `10022`). The number is that plus one, never zero-padded (`AM-1`, `AM-10`; `1` for the first track).
   The id is `INITIALS-<n>` without the slug; the folder is `INITIALS-<n>-slug/`.
2. **Create `conductor/tracks/INITIALS-<n>-slug/index.md` right away**, for fast feedback:
   ```markdown
   # Track INITIALS-<n>: [name]

   **Lane**: plan
   **Lane Status**: queue
   **Progress**: 0%
   **Phase**: New
   **Type**: [dev|marketing|sales|support|other]
   **Merge Mode**: direct
   **Auto Run**: no
   **Author**: INITIALS
   **Created By**: user@email.com
   **Summary**: [description]
   ```
   `**Type**` defaults to `dev`; `**Merge Mode**` and `**Auto Run**` to `direct` and `no` (as create_track does). Write `pr` / `yes` only when the
   user asks for it on this track ("this one needs a PR, auto-run it").
3. **Non-dev types.** For `marketing`, `sales` or `support`, say which of the skills the Type works best with are installed. A skill is
   installed when it is in the session's skills list, in `claude plugin list`, or in `.claude/skills/` or `~/.claude/skills/`; an older
   name counts. For each one installed say "you have `<skill>` installed, use it before writing the content". Offer the missing ones:

   Look first (the session skills list, `claude plugin list`, `.claude/skills/`, `~/.claude/skills/`; an older name counts) and offer only what is missing: at most two, plain text, each install command alone in its own bash block, never run an install, never block, nothing twice in a session or on the declined list. Offer when the track is created, planned and implemented.

Candidates for these Types:

- `marketing-skills` (prerequisite; Type marketing/sales): skills content-strategy, launch (was launch-strategy), copywriting, social (was social-content), sales-enablement, cold-email, prospecting, revops, analytics (was analytics-tracking), ab-testing (was ab-test-setup). Markdown only. `claude plugin marketplace add coreyhaines31/marketingskills`, `claude plugin install marketing-skills@marketingskills`
- `customer-support` (Type support): skills ticket-triage, draft-response, kb-article, customer-escalation, customer-research. Installs connections to hosted services (Slack, Intercom and more), plus skills. `claude plugin marketplace add anthropics/knowledge-work-plugins`, `claude plugin install customer-support@knowledge-work-plugins`

4. Create `history.md` beside the other files, with one header line (`# History: Track INITIALS-<n>`, the id only) and nothing else.
5. Print `✅ Track <n> created in conductor/tracks/<folder>/.`

### `ops/tracks.md` (What goes in each track file; Splitting a plan that holds a log)

#### What goes in each track file

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

#### Splitting a plan that holds a log

A plan has become a log when two or more of its headings are dated (`## 2026-11-18`, `### 18 Nov`) or start with STATUS, RELEASE, INCIDENT, UPDATE or LOG, or when it is over 60 KB. (With the add-on, `get_track` warns with `plan_has_log`, `list_tracks` and the track summary name the tracks.) A plan with many task checkboxes is not a log: never split a plan for having many tasks.

1. **Ask first.** Say which plan, how many dated sections and how large it is, and ask "Split it now? [default: yes]". Change nothing without the answer.
2. **Dated sections go to `history.md`.** Each status, release or incident section becomes one dated line, `- <YYYY-MM-DD HH:MMZ> <emoji> <one line>`, oldest first, keeping its hashes, URLs and numbers. Use the section's own date; when it has none, use the date of the commit that added it (`git log -S`). A long section's detail is not thrown away: it stays under its line in `history.md` as indented continuation lines (two spaces), so the log stays in git.
3. **Decisions go to `spec.md`.** A design decision, a requirement or an acceptance criterion found in the plan moves to `spec.md` with its date and its reason.
4. **The plan keeps the work breakdown.** Phases and the checkbox tasks stay in `plan.md`, their ticks unchanged.
5. **Never delete.** Everything removed from the plan exists in `history.md`, `spec.md` or `conversation.md` afterwards; the old text stays in git. Commit the files together with explicit paths, and add one `history.md` line saying the plan was split.
