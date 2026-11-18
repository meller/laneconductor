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
4. **Non-dev types.** For `marketing` or `sales`, look in `.claude/skills/` for the recommended
   skills (marketing: `social-content`, `copywriting`, `content-strategy`, `launch-strategy`;
   sales: `sales-enablement`, `cold-email`) and tell the user which are missing.
5. Print `✅ Track NNN created in conductor/tracks/<folder>/.`
