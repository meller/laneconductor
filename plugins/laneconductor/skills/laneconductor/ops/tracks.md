# Track operations

The daemon's conversation-reply prompt calls `comment` and `move`, so these are live commands, not
legacy. Where a `lc` command exists it is the recommended route: it applies the same rules as the
worker. The file edits below are the fallback for sessions without `lc`.

## newTrack `[name] [description]`

Recommended: `lc new "Title" "Description"` (add `--merge-mode pr` / `--auto-run no` to opt a
track out of the defaults). By hand:

1. **Number and author initials.** Take initials from `git config user.name` (first letter of each
   word, at most 3, `XX` if unset: "Asaf Meller" -> `AM`, "John von Neumann" -> `JVN`). Find the
   highest existing number by scanning `conductor/tracks/file_sync_queue.md` (`### Track NNN:`)
   and every folder name under `conductor/tracks/`, ignoring any prefix (`10022-slug` and
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
3. **Queue it.** Append to `conductor/tracks/file_sync_queue.md` under `## Track Creation Requests`:
   ```markdown
   ### Track NNN: [name]
   **Status**: pending
   **Type**: track-create
   **Created**: [ISO timestamp]
   **Title**: [name]
   **Description**: [description]
   **Author**: INITIALS
   **Metadata**: { "priority": "medium", "assignee": null }
   ```
   The sync worker (chokidar, or the 5s heartbeat) creates the DB row and moves the entry to
   `## Completed Queue`.
4. **Non-dev types.** For `marketing` or `sales`, look in `.claude/skills/` for the recommended
   skills (marketing: `social-content`, `copywriting`, `content-strategy`, `launch-strategy`;
   sales: `sales-enablement`, `cold-email`) and tell the user which are missing.
5. Print `✅ Track NNN queued in file_sync_queue.md. Worker will register in DB on next cycle.`

## move `[track-number] [lane:status]`

Moving to a lane without a status means `queue`: `move NNN backlog`, `move NNN implement:queue`
(the worker picks it up), `move NNN plan:success` (parked as done planning). Run
`lc move NNN lane:status`; without `lc`, set `**Lane**` and `**Lane Status**` in
`conductor/tracks/NNN-*/index.md`. The sync worker notices the change and queues the work.
Prefer a `lane:status` that `workflow.json` defines for that lane. When the move is "this lane's action
finished", do not work the target out yourself: with the connector, call `update_track` with `outcome`
(`success` or `failure`) and the `base` from `get_track`, which applies the workflow's move; its answer to
"where does it go" is `valid.next` in `get_track`. Without the connector, read `workflow.json` with the
grammar in [lanes-and-statuses.md](lanes-and-statuses.md) (a bare target is `queue` for another lane;
for the same lane it is `success` or `failure`).

## pulse `[track-number] [status] [progress%] [summary?]`

Update the track's markers in `conductor/tracks/NNN-*/index.md`: `**Progress**: N%`, `**Phase**`
when the work entered a new phase, `**Step**` (the current activity; infer it if not given),
`**Summary**`, and `**Waiting for reply**: no` after every AI response. The sync worker pushes
the change to the DB. A `[status]` that names a lane is a move, so use `move` for that;
`pulse` does not write `**Status**` any more (it is a legacy marker the parser only reads when
`**Lane**` is missing).

## comment `[track-number] [body]`

Append `> **system**: [body]` (format rules in SKILL.md) to `conductor/tracks/NNN-*/conversation.md`.
The sync worker pushes it to the database. Use `⚠️` for something that needs a human and `ℹ️` for
a note. This is also how an agent answers a human comment.

## delete `[track-number]`

A hard delete with no undo; the recommended soft alternative is `move NNN backlog`. Ask the user
to confirm first, naming the track title. Then `lc delete NNN`, or by hand:
1. `rm -rf conductor/tracks/NNN-*/` after the confirmation.
2. Remove the track's entry from `conductor/tracks/file_sync_queue.md`.
3. If `mode` is `local-api` or `remote-api`, call `DELETE /api/projects/:id/tracks/NNN`.
4. Remove its lock and worktree: `node conductor/unlock.mjs NNN`, or delete
   `.conductor/locks/NNN.lock` (the path `conductor/lock.mjs` writes) by hand.
5. Print `✅ Track NNN deleted`.

## revert `[track] [phase] [task?]`

Safe undo at track, phase or task level (the conductor `revert` behaviour). Afterwards re-parse
`plan.md`, recalculate `**Progress**` from its checkboxes, and, if a done track went back into
a phase, set the lane back to `implement`.

## status

Run `lc status` (it also checks worker health). Without `lc`, read `**Lane**`, `**Progress**` and
`**Phase**` from every `conductor/tracks/*/index.md` and print the tracks grouped by lane.

## workflow, workflow set `[lane] [key] [value]`

What the lanes, the five lane statuses and the `on_success` / `on_failure` targets mean (and the defaults
of a bare target) is in [lanes-and-statuses.md](lanes-and-statuses.md); read that rather than guessing from
the file. A `workflow.json` that still has bare targets, `auto_action` or the old lane names (`planning`,
`in-progress`) is the daemon-era format: it works, and migrating it is only ever offered (see the command
text), never done without the person's yes.

`lc workflow` prints `conductor/workflow.json` as a table (lane, auto action, on_success,
on_failure, retries, model); `lc workflow set <lane> <key> <value>` edits one field. Without
`lc`, edit the JSON: `lanes[lane][key]`, or `global[key]` / `defaults[key]` when the lane is
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

These are CLI commands with no skill-side procedure: run `lc update-track [id] [msg]` (adds
work, a bug or a feature to an existing track and returns it to backlog), `lc report-bug [desc]`
and `lc feature-request [desc]` (each updates a matching track or creates a new bug / feature
track). Without `lc`, the recommended equivalent is: search `conductor/tracks/*/index.md` for a
matching track; if one exists append the new detail to its `conversation.md` and `move NNN backlog`,
otherwise create one with newTrack and set `**Track Kind**: bug` or `feature`.

A new bug or feature track is a form, not the generic skeleton. A bug `spec.md` has, after
`## Problem Statement`: `## Symptom`, `## Steps to reproduce`, `## Expected result`,
`## Actual result`, `## Suspected area`, `## Environment`, and its `test.md` starts with a
regression-test case that reproduces the bug and fails before the fix. A feature `spec.md` has
`## The need`, `## Who it is for`, `## Wanted outcome`, `## Acceptance criteria`, `## Out of scope`.
The exact text is in [setup/templates.md](../setup/templates.md) ("Track spec forms"); the
laneconductor-parallel add-on's `mcp__plugin_laneconductor-parallel_lc__create_track` with `track_kind` writes the same forms when it is present.

## init-tracks-summary

Regenerates `conductor/tracks.md` (counts per lane, tracks grouped by lane) from every track's
`index.md`: run `lc init-summary` or `node conductor/init-tracks-summary.mjs` from the LaneConductor
install path (the path in `~/.laneconductorrc` leads to it). Run it manually whenever the summary looks stale.
