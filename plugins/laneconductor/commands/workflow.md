---
description: Show the lane workflow, or change one lane setting
argument-hint: "[lane key value]"
---
Workflow: `$ARGUMENTS` (nothing given means show). The procedure is the skill file `ops/tracks.md` (`workflow`, `workflow set`).

This command carries the skill text it uses, at the end under "Reference". Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the command are references only.

1. Read `conductor/workflow.json` and print a table: lane, `on_success`, `on_failure` as the resolved `lane:status` (the reference is the skill file `ops/lanes-and-statuses.md`; a bare target is `queue` for another lane, `success` or `failure` for the same lane), retries, model.
2. If the file is still in the older format (bare targets, `auto_action`, the lane names `planning` and `in-progress`), say so and OFFER to rewrite the file to the current format: show the exact new file first, copy the old one to a backup next to it before anything is written, and write nothing until I say yes. Never rename lanes in existing tracks. It works as it is, so declining changes nothing.
3. With `lane key value`, confirm the one field with me, change only that field in the file, and print `workflow.json updated: lanes.<lane>.<key> = <value>`. Edit nothing else.

## Reference

From the skill files this command names, copied here: whole files, or only the sections the command uses.

### `ops/tracks.md` (workflow, workflow set)

#### workflow, workflow set `[lane] [key] [value]`

What the lanes, the five lane statuses and the `on_success` / `on_failure` targets mean (and the defaults
of a bare target) is in `ops/lanes-and-statuses.md`; read that rather than guessing from
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

### `ops/lanes-and-statuses.md` (The five lane statuses; Transitions; Lane names)

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
| `stay` or `stop` | no automatic move. Older files carry these words; they are read, never written, so do not put them in a file |

An unknown current lane is an error; do not guess. Names are compared ignoring case and spaces. Fields of the older format
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

#### Lane names

A project names its own lanes in `conductor/workflow.json`; the guides and commands use the standard names. The standard names replaced the old ones:
`planning` to `plan` and `in-progress` to `implement`; older projects (and the older-format files they carry) keep the old names, and existing tracks
are never renamed. The lane guides stand for the project's lane that means the same thing: `plan` is `planning`, `implement` is `in-progress`.
The connector reports this mapping as `valid.guide_lanes` (and the project's lane names as `valid.lanes`); without it, match by meaning. Write
the project's own names into `**Lane**`.
