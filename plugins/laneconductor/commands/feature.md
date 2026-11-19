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
