---
name: laneconductor
description: Plan, implement, review, quality-gate and merge LaneConductor tracks - the folders under conductor/tracks/ holding index.md, spec.md, plan.md, test.md and conversation.md - and create, move, update or comment on them. Use for any work on a LaneConductor track or any /laneconductor command.
when_to_use: Use when the user says things like "plan track 10109", "plan this", "write the spec for track N", "implement track N", "run track N", "review track N", "run the quality gate on N", "merge track N", "create a track for ...", "file a bug as a track", "move N to implement", "comment on track N", "what is the status of track N", "board", "show the board" or "update the board", and for the worker's automated prompts "/laneconductor plan|implement|review|qualityGate|merge N", "/laneconductor board". Setting up LaneConductor in a repo (setup, setup scaffold, setup-deploy, deploy) runs only when the user asks for it by name.
argument-hint: "[command] [track-number] [args]"
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---
<!-- Portions of workflow protocols adapted from superpowers by Jesse Vincent (MIT License) -->

# LaneConductor

Tracks are folders under `conductor/tracks/`. Each moves through lanes (plan, implement, review,
quality-gate, done) and every lane writes its state as bold markers in the track's `index.md`.
This works with or without a running worker: the markers are the interface, a sync worker (if any)
only reads them.

Paths below are relative to this file's directory: `.claude/skills/laneconductor/` in a project, or
the plugin's `skills/laneconductor/` when installed as the LaneConductor plugin. If you only received this text (some non-Claude CLIs paste
`SKILL.md` without a path), read the lane files from that directory.

LaneConductor is a second opinion, not a controller. Lanes, recipes and conventions here are
recommendations with reasons; you may decide against one, but say why in `conversation.md` so the
recipe can be fixed or pruned. Two things are firm because breaking them corrupts state or
overrides the human: the file formats and base-commit checks below, and the human's authority
(ask before merge or push, never handle secrets).

## How to run a command

1. Take the first argument (`/laneconductor plan 123` -> `plan`) and find it in the table below.
2. Read the named file in full before doing anything else. That file plus this index is the
   whole instruction set for the command; do not load the other folders.
3. After a context compaction, read the file again: a Read result is not re-attached the way a
   skill is.
4. A command that is not in the table: say so and stop.

| Command | Read | May start unprompted |
|---------|------|----------------------|
| `plan` | [lanes/plan.md](lanes/plan.md) | yes |
| `brainstorm` | [lanes/brainstorm.md](lanes/brainstorm.md) | yes |
| `implement` | [lanes/implement.md](lanes/implement.md) | yes |
| `review` | [lanes/review.md](lanes/review.md) | yes |
| `qualityGate`, `quality-gate` | [lanes/quality-gate.md](lanes/quality-gate.md) (the worker sends `qualityGate`) | yes |
| `merge`, `done` | [lanes/merge.md](lanes/merge.md) (the `done` lane's action) | yes |
| `newTrack`, `updateTrack`, `reportaBug`, `featureRequest` | [ops/tracks.md](ops/tracks.md) (prefer `lc new`, `lc update-track`, `lc report-bug`, `lc feature-request`) | yes |
| `move`, `pulse`, `comment`, `revert`, `status`, `workflow`, `workflow set`, `init-tracks-summary` | [ops/tracks.md](ops/tracks.md) | yes |
| `run track N`, work a track end to end | [ops/working-a-track.md](ops/working-a-track.md) (lessons and guardrails; read the lane file for each lane you run) | yes |
| `board`, `show the board`, `update the board` | [ops/board.md](ops/board.md) (a private artifact showing every track by lane; Claude creates and refreshes it) | yes |
| `delete` | [ops/tracks.md](ops/tracks.md) | only when named |
| `setup`, `setup collection` | [setup/setup.md](setup/setup.md) | only when named |
| `setup scaffold`, `setup scaffold generate` | [setup/scaffold.md](setup/scaffold.md) (templates in [setup/templates.md](setup/templates.md)) | only when named |
| `setup-deploy`, `setup-deploy generate` | [deploy/setup-deploy.md](deploy/setup-deploy.md) | only when named |
| `deploy` | [deploy/deploy.md](deploy/deploy.md) | only when named |

**The board.** `board` (or "show the board", "update the board") gives the project one private page that
shows every track by lane, with a needs-attention list. `lc board --site <dir>` writes the page and its
data; Claude then publishes them as an artifact and keeps its URL in `.laneconductor.json`
(`board.artifact_url`). It is a snapshot: it changes only when Claude refreshes it. Steps are in
[ops/board.md](ops/board.md).

Not in the plugin: the daemon-era tier (the `start`, `activate`, `stop`, `deactivate`, `lock`, `unlock`, `syncdb` and `remote-sync` commands and the Postgres schema) is parked legacy. Its files live in the skill of the LaneConductor repository, not here; if the user asks for one of those commands, say so and stop.

## Finding a track

A track number maps to one folder under `conductor/tracks/`. Run `lc track-dir <N>`: it prints the
folder (exit 0) using the same resolver as the sync worker (`conductor/services/track-folder.mjs`),
is read-only, and handles both naming conventions: `INITIALS-NNN-slug` (for example
`AM-10023-my-feature`, the current form) and the legacy bare `NNN-slug`. `--json` gives
`{ folder, matches, registered }`.

Without `lc`: check the number's `folder_path` in `conductor/tracks-metadata.json`, then scan
`conductor/tracks/` for **both** conventions (a legacy-only scan silently misses every prefixed
folder), then `conductor/tracks.md`, then `conductor/tracks/file_sync_queue.md`, which lists a
UI/CLI-created track as pending until the worker makes its folder.

If any folder exists for the number, use it. Scaffolding a second one is an error, not a
fallback: on track 10040 a scan that missed `AM-10040-...` created a duplicate `10040-...`.

## conversation.md format

Every entry in `conductor/tracks/NNN-*/conversation.md`, from an agent or a human, must look like:
```
> **author**: First line of the message
> second line, also prefixed with >
```
`author` is `human`, `claude`, `gemini` or `system`. The sync worker's parser recognizes only
`> **author**: ...` lines plus `>`-prefixed continuations. Anything else (a markdown header, a plain
blockquote, loose prose) stays in the file but is silently never synced to the UI, with no error.
For long pasted material (an email, a contract, a redline) keep one opening `> **author**:` line and
prefix every following line, blank ones and markdown headers included, with `>`. Do not drop the
prefix partway because the content reads like a document.

## Session continuity

Worker prompts start with `FRESH_SESSION: true` or `FRESH_SESSION: false`. On `true`, do every
"load context" step. On `false` the worker resumed your own session on this track (track 1086), so
skip re-reading files you already read in it, but still read anything new: a human comment in
`conversation.md`, a file that did not exist, command output you just produced. Resumed means
"don't redo work", not "ignore new information". No marker at all (a skill-only session) means
treat it as `true`.

**On-disk content wins over memory (track AM-10090).** Before rewriting `spec.md`, `plan.md` or
`test.md` wholesale on a resumed turn, re-read them. If the file differs from what you remember
writing, someone else (a human or another session) has acted since; reconcile with it instead of
overwriting. Track AM-1020 is the incident: a resumed session re-asserted a stale "blocked, no
requirements" conclusion over a fresh respec, three times in ten minutes. The worker's document-digest
check (`conductor/services/track-doc-digest.mjs`) is only a backstop; it covers `spec.md`,
`plan.md`, `test.md` and a few `index.md` markers, and skill-only sessions have none.

## Lanes and transitions

- `conductor/workflow.json` is the only authority for where a lane sends a track. Read it at the
  start of each lane command; targets are written as `lane:status` (`review:queue`). Do not assume
  implement follows plan: this project's `plan.on_success` is `plan:success`, and a project may
  put a review lane between them.
- Each lane has one job: plan writes documents only; implement executes `plan.md`; review and
  quality-gate evaluate and never fix (quality-gate ends at `done:queue`, never `done:success`);
  merge only merges or opens a PR (`done:success` means reachable from `main`).
- **A human's manual move wins.** Before writing any transition, re-read `**Lane**` in `index.md`.
  If it is no longer your lane, leave `**Lane**` and `**Lane Status**` alone and say so in your
  completion comment.
- **Completion comment.** Every lane action ends with exactly one comment in `conversation.md`:
  `> **system**: <emoji> <one-line summary>.` The emoji is the very first character of the body
  (the Inbox classifies on it): `✅` success, no action needed; `⚠️` a human should look; `❌` failed.
  If an earlier step already posted a `⚠️`/`❌` comment for the outcome, that one is enough.
- **Parking on other tracks.** To wait for tracks that have not shipped, set `**Lane Status**: waiting`
  and `**Waiting On Tracks**: NNN, NNN`. The reconciler resumes the track once every named track is
  `done` with a successful action (`done:queue` is not enough: it is gated but not merged). A bare
  `**Depends On**` is not attribution; a park for a question or approval is never auto-resumed.

## Markers in index.md

| Marker | Meaning |
|--------|---------|
| `**Lane**`, `**Lane Status**` | Where the card sits (`queue`, `running`, `success`, `failure`, `waiting`). Every lane claims with both. |
| `**Progress**: N%` | Derived from the `plan.md` checkboxes; keep those accurate. |
| `**Phase**`, `**Summary**`, `**Step**` | Current phase name, one-line summary, current activity. |
| `**Waiting for reply**: yes\|no` | A human comment needs an answer; also the Inbox signal for supervised work. |
| `**Type**` | `dev`, `marketing`, `sales`, `support`, `other`. Non-dev tracks get supervised implement and a KPI. |
| `**Track Kind**: bug\|feature` | Written only by plan; feeds the default workspace (bug -> main). |
| `**Workspace**: main\|branch` | A deliberate human override of where lane actions run; never infer it. |
| `**Auto Run**: yes\|no` | Whether the worker may claim the track from the queue by itself (absent means no). |
| `**Merge Mode**: direct\|pr` | How the done lane integrates the branch (absent means `pr`). |
| `**PR URL**` | Written by the merge lane in pr mode. |
| `**Verdict**: pass\|fail` | Written by review and quality-gate; cleared at claim. |
| `**Depends On**: NNN, NNN` | Tracks that must be `done` before a queued lane action may auto-launch. |
| `**Waiting On Tracks**: NNN, NNN` | See parking above. |

Commits that belong to a track say so: `feat(track-NNN): ...`, `fix(track-NNN): ...`,
`docs(track-NNN): ...`; `refactor:` for changes across several tracks.
