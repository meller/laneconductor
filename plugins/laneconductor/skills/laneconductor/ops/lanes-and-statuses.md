# Lanes, lane statuses and transitions: the one reference

Read this when you move a track, finish a lane action, or meet a `workflow.json` you did not write. It is the single current
description; where an older text disagrees with it (for example the old three-status list, `queue`, `success`,
`failure`), this file is right and the older text is superseded.

## The model

- **Lane** is where the track sits: `plan`, `implement`, `review`, `quality-gate`, `done` (and `backlog`, the place before any lane).
- **Lane status** is the state of the work *inside that lane*. It is a second marker, `**Lane Status**`, next to `**Lane**`.
- A lane action finishing is a **status event first**. The workflow's `on_success` and `on_failure` then say where the card goes next.

## The five lane statuses

| Status | Meaning |
|--------|---------|
| `queue` | Waiting for the lane's action to start (or to be picked up). A track that just moved into a lane is `queue`. |
| `running` | An agent is executing this lane's action **right now**. |
| `success` | The lane's action finished well, and the track rests here (for example `plan:success`: planned, parked). |
| `failure` | The lane's action failed or could not finish; a person or a retry decides next. |
| `waiting` | Parked on purpose until a human (or a named track) acts: a question, an approval, a dependency. |

**`running` belongs to the lane whose action is executing.** It is never used for work that belongs to another lane. A deploy
gate (the full suites, then the deploy) is `quality-gate:running`, not `implement:running` and not `in-progress:running`.

## The two meanings of `done`

- `done:queue`: the track passed the quality gate. It is **not shipped**.
- `done:success`: shipped, the merge action finished (the code is reachable from `main`, or the PR is merged).

Only the quality gate moves a track to `done`. Nothing moves a track to `done:success` straight after implementing.

The other two statuses in the done lane are work somebody still has to finish: `done:failure` is a merge that failed, `done:waiting` is a
pull request that is open. Only `done:success` is quiet. With the connector, `list_tracks` hides only `done:success` unless
`include_done` is set, and adds `merged` to a done track whose `track-NNN` branch exists (true when the state branch contains it; no field
when there is no such branch, because the files cannot tell merged-and-deleted from never branched). The board lists `done:queue`,
`done:failure` and `done:waiting` under Needs attention, each with its reason.

## Transitions

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

## Where the answer comes from

- **With the connector tools present:** `get_track` returns `valid.next`, for example
  `{ "success": "review:queue", "failure": "implement:failure" }` for the track's current lane (`null` for a direction with no automatic
  move); `get_context` returns `valid.next_by_lane` for every lane. To apply a transition, call `update_track` with
  `outcome: "success"` or `"failure"` (and the `base` from `get_track`) instead of setting `Lane` and `Lane Status` yourself; it is
  refused when the workflow has no automatic move from that lane. `outcome` and the `Lane` / `Lane Status` markers are mutually exclusive.
- **Without them:** read `conductor/workflow.json` and apply the table above by hand. Never compute a target from the raw text any other
  way, and never fill in a missing status by feel: a bare target has exactly the defaults above.

## Lane names

A project names its own lanes in `conductor/workflow.json`; the guides and commands use the standard names. The standard names replaced the old ones:
`planning` to `plan` and `in-progress` to `implement`; older projects (and the older-format files they carry) keep the old names, and existing tracks
are never renamed. The lane guides stand for the project's lane that means the same thing: `plan` is `planning`, `implement` is `in-progress`.
The connector reports this mapping as `valid.guide_lanes` (and the project's lane names as `valid.lanes`); without it, match by meaning. Write
the project's own names into `**Lane**`.

## Manual moves win

A human's move of a card always wins. Before writing any transition, re-read `**Lane**` in `index.md`; if it is no longer the lane you worked
in, leave `**Lane**` and `**Lane Status**` alone and say so in the completion comment. If you deliberately skip a lane (for example the
deploy gate stands in for review), note the skip in `conversation.md`; following the workflow strictly means taking `on_success`.
