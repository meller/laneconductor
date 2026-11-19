---
description: Move a track to another lane, or set its status markers
argument-hint: <track number> <lane[:status]>
---
Arguments: `$ARGUMENTS` (track number, then lane[:status]).

This command carries the skill text it uses, at the end under "Reference". Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the command are references only.

Move track <track> to <lane> (a `lane` or `lane:status`; a bare lane means `queue`). The procedure is the skill file `ops/tracks.md` (`move`, `pulse`, `updateTrack`).

1. Check `conductor/workflow.json` for a `lane:status` that lane defines; use the lane names of that file (a project may call a lane `planning` or `in-progress`). If the move is "this lane's action finished", read the target with the grammar of the skill file `ops/lanes-and-statuses.md` (a bare target is `queue` for another lane and `success` or `failure` for the same lane), never from the raw file by guess.
2. Re-read the track's `index.md` right before editing, then change only the marker lines: `**Lane**` and `**Lane Status**` (a progress or phase update is `**Progress**` or `**Phase**`). A move out of `waiting` also clears `Owner Action`, `Owner Action Due` and `Waiting for reply`.
3. Say what changed. Moving a track only sets markers; it starts no work.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__get_context`, `mcp__plugin_laneconductor-parallel_lc__get_track`, `mcp__plugin_laneconductor-parallel_lc__update_track`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.

## Reference

From the skill files this command names, copied here: whole files, or only the sections the command uses.

### `ops/tracks.md` (move; pulse)

#### move `[track-number] [lane:status]`

Moving to a lane without a status means `queue`: `move NNN backlog`, `move NNN implement:queue`
(it waits in that lane), `move NNN plan:success` (parked as done planning). Set `**Lane**` and
`**Lane Status**` in `conductor/tracks/NNN-*/index.md` (with the add-on, `update_track` with those markers).
Prefer a `lane:status` that `workflow.json` defines for that lane. When the move is "this lane's action
finished", do not work the target out yourself: with the connector, call `update_track` with `outcome`
(`success` or `failure`) and the `base` from `get_track` (it applies the workflow's move; `valid.next` says
where it goes); without it, read `workflow.json` with the grammar in `ops/lanes-and-statuses.md`.

#### pulse `[track-number] [status] [progress%] [summary?]`

Update the track's markers in `conductor/tracks/NNN-*/index.md`: `**Progress**: N%`, `**Phase**`
when the work entered a new phase, `**Step**` (the current activity),
`**Summary**`, and `**Waiting for reply**: no` after every AI response. A `[status]` that names a lane is a move, so use `move` for that;
`pulse` no longer writes the legacy `**Status**`.

### `ops/lanes-and-statuses.md` (The five lane statuses; Transitions; Manual moves win)

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
| `stay` or `stop` | no automatic move (older files; read, never written) |

An unknown current lane is an error; do not guess. Names are compared ignoring case and spaces. Fields of the older format
are ignored: `auto_action`, `parallel_limit`, `max_retries`, `global`, `primary_model`, `hooks`.

Worked examples. This project's own file:

| Lane | on_success | on_failure |
|------|-----------|-----------|
| plan | `plan:success` (stays, parked) | `backlog:queue` |
| implement | `review:queue` | `implement:failure` |
| review | `quality-gate:queue` | `implement:queue` |
| quality-gate | `done:queue` | `plan:queue` |
| done | none | `done:failure` |

An older file (bare targets, old lane names) resolves by the table above: `in-progress` with `"on_success": "review"` and `"on_failure": "in-progress"` gives `review:queue` and `in-progress:failure`; a `null` target has no automatic move.

#### Manual moves win

A human's move of a card always wins. Before writing any transition, re-read `**Lane**` in `index.md`; if it is no longer the lane you worked
in, leave `**Lane**` and `**Lane Status**` alone and say so in the completion comment. If you deliberately skip a lane (for example the
deploy gate stands in for review), note the skip in `conversation.md`; following the workflow strictly means taking `on_success`.
