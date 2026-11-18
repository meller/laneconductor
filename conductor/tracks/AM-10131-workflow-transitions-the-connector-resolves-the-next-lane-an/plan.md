# Track 10131: Workflow definition and transitions: one current reference, and the connector resolves the next lane and status

## Sources (already decided, daemon era; this track brings them into the plugin)

- Track 1016 (done) defined the Lane Status enum: `queue`, `success`, `failure` (then, later, `running` and `waiting`; the code today has five: `connector/src/markers.mjs` STATUSES).
- Track 1020 (done) defined the workflow: `lane:status` transitions in `on_success` and `on_failure`; a bare target defaults to `queue` when it names a DIFFERENT lane and to `success` (on_success) or `failure` (on_failure) when it names the SAME lane; the lane name is the action; standardized lane names `plan` (was `planning`), `implement` (was `in-progress`), `review`, `quality-gate`; `auto_action` removed. Those rules lived in the sync daemon's worker and were never carried into the plugin's tools, which is why a model had to guess.
- otralingo's `conductor/workflow.json` predates 1020 (last changed 2026-04-15): old lane names `planning` and `in-progress`, bare targets, `auto_action`, `parallel_limit`, `max_retries`, `global`, `defaults`, and `planning` succeeding into `backlog`.

## The model (owner, 2026-11-18): lane and lane status are different things

- LANE is where the track sits. LANE STATUS is the state of the work inside that lane: `queue` (waiting to start), `running` (an agent is executing that lane's action NOW), `success`, `failure`, `waiting` (parked on a human or another track).
- A lane action finishing is a STATUS event first (running to success or failure); the workflow's `on_success` and `on_failure` then say where the card goes.
- `done` has two meanings: `done:queue` = passed the quality gate, not shipped; `done:success` = shipped (merged or deployed). A bare `done` target from another lane is `done:queue` (1020's default), never `done:success`.
- `running` is never used for work that belongs to another lane: a deploy gate (full suites, then deploy) is the quality gate, so it is `quality-gate:running`, not `in-progress:running`.
- A human's manual move always wins over the workflow (for example finishing a deploy track straight to `done:success` is allowed); the agent notes the deliberate skip in the track's conversation.

## Phase 0: The canonical reference

- [ ] Task 1: ONE current document in the skill (for example `ops/lanes-and-statuses.md`), in plain language: the lanes, the five statuses and what each means, the transition grammar and 1020's defaults, the two `done` statuses, `running` belongs to the lane whose action is executing, manual moves win, and the old-to-new lane names (`planning` to `plan`, `in-progress` to `implement`) with how a project's own lane names map onto the guide lanes (`valid.guide_lanes`). Sourced from 1016 and 1020 and the code; mark 1016's three-status text as superseded
- [ ] Task 2: The skill's index table, `/laneconductor:workflow` and the lane guides point at it instead of repeating partial definitions; the generator ships it in the base (Markdown) and a test checks the five statuses and the two done meanings appear

## Phase 1: The resolver

- [ ] Task 1: A pure function in the connector: (workflow.json, current lane, outcome) to `{ lane, status } | null`, implementing 1020's grammar exactly, for the legacy and the current formats; `null` target means no automatic move; project lane names resolve through the guide-lane mapping
- [ ] Task 2: Table-driven tests: otralingo's real workflow.json (planning, in-progress, bare targets), our current default, a custom lane, success and failure for every lane, null targets, unknown lanes, same-lane and different-lane bare targets, a bare `done`

## Phase 2: Expose it

- [ ] Task 1: `get_track` and `get_context` carry `valid.next` for the track's current lane (additive)
- [ ] Task 2: `update_track` accepts `outcome: success | failure` (mutually exclusive with Lane and Lane Status markers), applies the resolved transition in one commit, keeps the base and CONFLICT rules; a null transition is refused with the reason
- [ ] Task 3: stdio smoke test with an otralingo-style workflow.json: outcome success on an in-progress track lands in review:queue

## Phase 3: The text

- [ ] Task 1: Lane guides and the base commands (`move`, `implement`, `review`, `quality-gate`, `run`) say: use `valid.next` or `outcome`, never compute targets from the raw file; without the add-on read workflow.json with 1020's grammar
- [ ] Task 2: A test that no generated text says 'done:success after implement' and that the reference is linked

## Phase 4: Migration offer (not automatic)

- [ ] Task 1: `/laneconductor:workflow` shows a legacy workflow.json and offers a non-destructive rewrite of the FILE to the current format (backup first, ask before writing); it never renames lanes in existing tracks and never touches a project's file without a yes; the resolver works with the old names regardless

**Immediate guidance (no code)**: AM-1291 on otralingo: implementation is done, so it is no longer `in-progress:running`; the deploy gate is the quality gate: `quality-gate:running` (a deliberate skip of review, noted in the conversation), then `done:success` once deployed; following the workflow strictly means `review:queue` first.
