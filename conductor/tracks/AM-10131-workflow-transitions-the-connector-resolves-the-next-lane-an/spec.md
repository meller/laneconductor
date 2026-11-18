# Spec: Workflow transitions: the connector resolves the next lane and status from workflow.json (legacy and current formats)

## Problem Statement

Found 2026-11-18 on the otralingo project (track AM-1291, in-progress, running, deploy gate running): the agent planned to finish it as `done:success` while the project's workflow.json says in-progress succeeds into `review`. Two causes.

1. otralingo's `conductor/workflow.json` is in the OLD daemon-era format (last changed 2026-04-15): bare lane names as targets (`"on_success": "review"`, `"on_failure": "in-progress"`), `planning` succeeds into `backlog`, and daemon fields (`auto_action`, `parallel_limit`, `max_retries`, `global`, `defaults`). The current format uses `lane:status` targets (`review:queue`, `plan:success`, `implement:failure`). A bare target leaves the status undefined, so the model has to guess (and guessed done:success).
2. Nothing in the tools resolves a transition. In the old world the daemon applied `on_success` and `on_failure`; in the plugin world it is left to the model reading workflow.json, which is the thing that goes wrong.

- Symptom: a track is finished with an invented target (`done:success` instead of `review:queue`).
- Expected: the target comes from the project's workflow.json, resolved by one piece of code.
- Actual: the model guessed the status of a bare target.
- Suspected area: transition logic existed only in the sync daemon (experimental, currently unmaintained); the plugin tools had none.

## Background (decided in earlier tracks)

- Track 1016 (done) defined the Lane Status enum: `queue`, `success`, `failure` (later also `running` and `waiting`; the code today has five: `connector/src/markers.mjs` STATUSES).
- Track 1020 (done) defined the workflow: `lane:status` transitions in `on_success` and `on_failure`; a bare target defaults to `queue` when it names a DIFFERENT lane and to `success` (on_success) or `failure` (on_failure) when it names the SAME lane; the lane name is the action; standardized lane names `plan` (was `planning`), `implement` (was `in-progress`), `review`, `quality-gate`; `auto_action` removed. Those rules lived in the sync daemon and were never carried into the plugin's tools, so a model had to guess.

## Requirements

- REQ-1 Resolver: a pure, dependency-free module at `conductor/services/workflow-transitions.mjs`: given a project's workflow.json, a track's current lane and an outcome (`success`, `failure`), it returns the next lane and lane status, or no automatic move. It implements track 1020's grammar exactly and reads both the older and the current format.
- REQ-2 Grammar (the resolver's table): an explicit `lane:status` is used as written. A bare target naming a DIFFERENT lane means `lane:queue` (`review` is `review:queue`). A bare target naming the SAME lane means that lane with status `success` for on_success and `failure` for on_failure. A bare `done` from another lane is `done:queue`, never `done:success`. A `null` or absent target means no automatic move (`backlog` and `done` give no move). An unknown current lane is an explicit error, never a guess. A project's own lane names (otralingo: planning, in-progress) resolve through the guide-lane mapping (`valid.guide_lanes`).
- REQ-3 One logic, two callers: the connector and the daemon import the SAME module. No second copy of the transition parsing exists. The plugin generator ships the module inside the add-on at the same relative path, byte-identical to the source, so the import resolves in an installed plugin.
- REQ-4 Daemon sites: the daemon's transition sites (`conductor/agent-runtime.mjs`, `conductor/laneconductor.sync.mjs`, `conductor/services/orphaned-dispatch.mjs`, `conductor/services/resting-state.mjs`) call the shared module; nothing else in the daemon changes. A parity test runs the same table through the shared module and the old daemon behavior; every difference is named (D1-D11, see Decisions).
- REQ-5 `valid.next`: `get_track` carries `valid.next` (`{ success: 'review:queue', failure: 'in-progress:failure' }` for the track's current lane) next to `valid.lanes` and `valid.statuses`; `get_context` carries the table for every lane. Additive fields only.
- REQ-6 `outcome`: `update_track` accepts an optional `outcome: 'success' | 'failure'`, mutually exclusive with `markers` for Lane and Lane Status (and `files.index`). It applies the resolved transition in one commit and keeps the base and CONFLICT rules. An outcome that resolves to no automatic move is refused with the reason.
- REQ-7 Text: the skill's lane guides and the base commands (`move`, `implement`, `review`, `quality-gate`, `run`) tell Claude to use `valid.next` or `outcome`, never to compute the target from the raw file; the base text still works without the add-on by reading workflow.json with the documented normalization rule. No generated text says `done:success after implement`.
- REQ-8 Reference: ONE current document in the skill (`ops/lanes-and-statuses.md`), plain language: lanes, the five statuses, 1020's grammar and defaults, the two `done` statuses, where `running` belongs, manual moves win, the old-to-new lane names and how a project's own lane names map to the guide lanes. Track 1016's three-status text is marked superseded. The skill index, `/laneconductor:workflow` and the lane guides point at it; the generator ships it in the base (Markdown only).
- REQ-9 Migration offer, not automatic: `/laneconductor:workflow` shows an older-format workflow.json and offers a non-destructive rewrite of the FILE to the current format (backup first, ask before writing). It never renames lanes in existing tracks and never touches a project's file without the person's yes; the resolver works with the old names regardless.
- REQ-10 Safety: the daemon (experimental, currently unmaintained; stopped, git tag `v1-legacy`) is not started and no worker-spawning or mock-CLI suite is run from a worktree (they leak real processes against the primary checkout: tracks 10073, 10080, 10082). Only the pure unit tests of the touched modules run; no process started by the implementer is left running.

## Decisions

### The model (owner, 2026-11-18)

- LANE is where the track sits. LANE STATUS is the state of the work inside that lane: `queue`, `running` (an agent is executing that lane's action NOW), `success`, `failure`, `waiting`.
- A lane action finishing is a STATUS event first; the workflow's `on_success` and `on_failure` then say where the card goes.
- `done:queue` = passed the quality gate, not shipped; `done:success` = shipped. A bare `done` target from another lane is `done:queue`.
- `running` is never used for work that belongs to another lane: a deploy gate (full suites, then deploy) is `quality-gate:running`, not `in-progress:running`.
- A human's manual move always wins; the agent notes a deliberate skip in the conversation.
- ONE LOGIC, TWO CALLERS (owner): the daemon must use the same transition logic as the connector; it just runs from a different place. There is ONE implementation, a dependency-free ES module; the connector (local, plugin) and the sync daemon (remote, experimental, currently unmaintained) both call it. No second copy.

### Immediate guidance for AM-1291 (no code needed)

When the deploy and post-deploy checks pass, move it to `review` with status `queue`; only the quality gate moves a track to done. Implementation is done, so it is no longer `in-progress:running`; the deploy gate is the quality gate: `quality-gate:running` (a deliberate skip of review, noted in the conversation), then `done:success` once deployed; following the workflow strictly means `review:queue` first.

### Accepted parity differences D1-D11 (between the old daemon and the shared module)

Asserted in `connector/test/workflow-transitions-parity.test.mjs`; the index records them as accepted.

- D1: "same lane" is compared ignoring case and surrounding spaces (old: exact string).
- D2: a status is trimmed and only the first colon splits (old: `split(':')` kept the second piece only, untrimmed).
- D3: an empty lane with a status (`:queue`) and a lone colon are read as the current lane (old compared `''` against the current lane, so it counted as a move).
- D4: the daemon's spawn exit handler wrote the whole target, status included, into `**Lane**` (`**Lane**: build:queue`, not a lane); it now writes the lane part only.
- D5: resting-state: an empty-lane target (`:success`) is read as the lane itself (old: never matched).
- D6: resting-state: case and spaces are ignored in the comparison.
- D7: `stay` and `stop` are daemon-era words for "no target". The daemon keeps them (shim `NO_TARGET_STAYS`: the track stays in its lane with status success, failure or queue); the shared grammar does not know them. Since AM-10137 it reads them as no target (read only; nothing offers or writes them).
- D8: a missing or null target: the daemon still stays in the lane with a status (`implement:success` on success, `implement:failure` at max retries, `implement:queue` otherwise); the shared resolver says no automatic move, which the connector refuses for `outcome`.
- D9: `defaults.on_success` and `defaults.on_failure` of the daemon-era file: the daemon reads them when the lane has no target; since AM-10137 the shared resolver reads them too for a lane that omits the field. D9b (the one remaining difference): an explicit null never falls back in the shared resolver, while the daemon's `||` falls through a null to the default.
- D10: older-format bare targets agree: bare other lane is `queue`, bare same lane is `success` or `failure` (failure only at max retries in the daemon).
- D11: the daemon re-queues a bare same-lane failure that has not used max_retries (shim `RETRY_REQUEUE`); the shared resolver gives `failure`. Track AM-10138 (attempts marker bounded by max_retries) is where this shim's fate is decided.

## Data model and API

- Resolver: `resolveTarget(value, currentLane, outcome)` and `resolveNext(workflow, currentLane, outcome, { mapLane })` in `conductor/services/workflow-transitions.mjs`; the result is `{ lane, status }` or null (no automatic move), or an `UNKNOWN_LANE` error.
- `get_track`: `valid.next` for the track's current lane. `get_context`: the table for every lane.
- `update_track`: optional input `outcome` (enum `success` | `failure`); validation fails with a hint when it is combined with Lane or Lane Status markers; a null transition is refused with the reason; a stale base still gives CONFLICT and nothing is written.
- Fixtures for the tests: (A) otralingo's real older-format workflow.json (lanes planning, backlog, in-progress, review, quality-gate, done; bare targets), (B) this repository's current default, (C) a custom workflow with an extra lane and mixed formats (`connector/test/fixtures/workflow/`).

## Acceptance criteria

- [x] The resolver exists as one shared module and returns the expected lane and status for fixtures A, B and C, both outcomes (REQ-1, REQ-2; `workflow-transitions.test.mjs`).
- [x] The connector and the daemon import the same module; a test fails if a second copy of the grammar appears; the add-on ships a byte-identical copy (REQ-3).
- [x] The daemon's transition sites call the shared module, and the parity test names every difference D1-D11 (REQ-4; `workflow-transitions-parity.test.mjs`, which ran and passed in this checkout).
- [x] `get_track` and `get_context` carry `valid.next`; `update_track` accepts `outcome` with the refusals of REQ-6 (REQ-5, REQ-6; `workflow-outcome.test.mjs`, `resolveOutcome` in `connector/src/tools/common.mjs`).
- [x] The reference `ops/lanes-and-statuses.md` exists in the skill source and in the generated base, and the commands and guides use `valid.next` or `outcome` (REQ-7, REQ-8; `lanes-reference.test.mjs`).
- [x] `/laneconductor:workflow` offers the non-destructive rewrite with a backup and a yes first (REQ-9; the text is in `connector/src/commands.mjs`).
- [ ] The whole connector suite, `node scripts/build-plugin.mjs --check` and strict validation of the three plugins and the marketplace pass. Not verified here: 25 test files could not load in this checkout (the MCP SDK packages are not installed); the files that ran passed.
- [ ] TC-14, a human check: in the otralingo session, after updating, finish a real in-progress track with `outcome: success` and see it in `review:queue` on the board (owner).

## Risks and limits

- Two daemon sites were not patched and still pass a raw target string as a lane name (`intendedLane` for the implement lane's `on_success` and for `on_failure`); with a `lane:status` target that is not a lane. The parity test lists them for the owner.
- The resolver cannot guess for a lane the workflow does not have: it returns an explicit error and the track gets `valid.next` null with the reason.
- Without the add-on, the base text relies on the model reading workflow.json with the written grammar, which is the failure mode this track reduces but cannot remove.
- D1-D11 are accepted differences in the daemon's behavior; D9b and D11 remain real differences.

## Out of scope

- Starting or changing the daemon beyond replacing its target computation with calls to the shared module.
- Renaming lanes in existing tracks.
- Writing any project's workflow.json without the person's yes.
