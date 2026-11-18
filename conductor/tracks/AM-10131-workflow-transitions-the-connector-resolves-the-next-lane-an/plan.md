# Track 10131: Workflow definition and transitions: one current reference, and ONE resolver shared by the connector and the daemon

## Sources (already decided, daemon era; this track brings them into the plugin)

- Track 1016 (done) defined the Lane Status enum: `queue`, `success`, `failure` (later also `running` and `waiting`; the code today has five: `connector/src/markers.mjs` STATUSES).
- Track 1020 (done) defined the workflow: `lane:status` transitions in `on_success` and `on_failure`; a bare target defaults to `queue` when it names a DIFFERENT lane and to `success` (on_success) or `failure` (on_failure) when it names the SAME lane; the lane name is the action; standardized lane names `plan` (was `planning`), `implement` (was `in-progress`), `review`, `quality-gate`; `auto_action` removed. Those rules lived in the sync daemon and were never carried into the plugin's tools, so a model had to guess.
- otralingo's `conductor/workflow.json` predates 1020 (last changed 2026-04-15): old lane names, bare targets, daemon fields, and `planning` succeeding into `backlog`.

## The model (owner, 2026-11-18)

- LANE is where the track sits. LANE STATUS is the state of the work inside that lane: `queue`, `running` (an agent is executing that lane's action NOW), `success`, `failure`, `waiting`.
- A lane action finishing is a STATUS event first; the workflow's `on_success` and `on_failure` then say where the card goes.
- `done:queue` = passed the quality gate, not shipped; `done:success` = shipped. A bare `done` target from another lane is `done:queue`.
- `running` is never used for work that belongs to another lane: a deploy gate (full suites, then deploy) is `quality-gate:running`, not `in-progress:running`.
- A human's manual move always wins; the agent notes a deliberate skip in the conversation.
- ONE LOGIC, TWO CALLERS (owner): the daemon must use the same transition logic as the connector; it just runs from a different place. So there is ONE implementation, a dependency-free ES module; the connector (local, plugin) and the sync daemon (remote, parked tier) both call it. No second copy.

## Phase 0: The canonical reference

- [ ] Task 1: ONE current document in the skill (for example `ops/lanes-and-statuses.md`), plain language: lanes, the five statuses, 1020's grammar and defaults, the two `done` statuses, where `running` belongs, manual moves win, the old-to-new lane names and how a project's own lane names map onto the guide lanes (`valid.guide_lanes`). Mark 1016's three-status text as superseded
- [ ] Task 2: The skill's index table, `/laneconductor:workflow` and the lane guides point at it; the generator ships it in the base (Markdown only)

## Phase 1: The shared resolver (single source of truth)

- [ ] Task 1: A pure, dependency-free module at `conductor/services/workflow-transitions.mjs` (the existing home of lane logic that both tiers can reach): (workflow config, current lane, outcome) to `{ lane, status } | null`, 1020's grammar exactly, legacy and current formats; null target means no automatic move; project lane names resolve through the guide-lane mapping; an unknown lane is an explicit error
- [ ] Task 2: The connector imports THAT module (no copy); the plugin generator ships it inside the add-on at the same relative path (`conductor/services/workflow-transitions.mjs`, the add-on already ships a `conductor/` helper folder) so the import resolves in the installed plugin; a test proves the shipped copy is byte-identical to the source
- [ ] Task 3: Table-driven tests (fixtures A legacy otralingo, B current default, C custom) as in test.md

## Phase 1b: The daemon uses the same module

- [ ] Task 1: Find the daemon's transition sites (`conductor/agent-runtime.mjs` near the on_success handling, `conductor/laneconductor.sync.mjs` where it reads `on_success` and `on_failure` for lane results and verdicts, `conductor/services/orphaned-dispatch.mjs` `targetLaneOf`) and replace each target computation with a call to the shared module; change nothing else in the daemon
- [ ] Task 2: A PARITY test: the same table of workflow configs and outcomes through the shared module and through each daemon site's helper gives identical lane and status; any case where the old daemon behavior differs from 1020's grammar is listed in the report and decided by the owner (do not silently change daemon behavior)
- [ ] Task 3: SAFETY: the daemon is stopped and parked (git tag `v1-legacy`); do NOT start it, and do not run worker-spawning or mock-CLI test suites from a worktree (they leak real processes against the primary checkout: tracks 10073, 10080, 10082). Run only the pure unit tests of the modules you touch; after every test run check `ps aux | grep -E 'laneconductor.sync.mjs|lc-connector'` for processes you started

## Phase 2: Expose it through the connector

- [ ] Task 1: `get_track` and `get_context` carry `valid.next` for the track's current lane (additive)
- [ ] Task 2: `update_track` accepts `outcome: success | failure` (mutually exclusive with Lane and Lane Status markers), applies the resolved transition in one commit, keeps the base and CONFLICT rules; a null transition is refused with the reason
- [ ] Task 3: stdio smoke test with an otralingo-style workflow.json: outcome success on an in-progress track lands in review:queue

## Phase 3: The text

- [ ] Task 1: Lane guides and the base commands (`move`, `implement`, `review`, `quality-gate`, `run`) say: use `valid.next` or `outcome`, never compute targets from the raw file; without the add-on read workflow.json with 1020's grammar
- [ ] Task 2: A test that no generated text says 'done:success after implement' and that the reference is linked

## Phase 4: Migration offer (not automatic)

- [ ] Task 1: `/laneconductor:workflow` shows a legacy workflow.json and offers a non-destructive rewrite of the FILE to the current format (backup first, ask before writing); never renames lanes in existing tracks, never touches a project's file without a yes; the resolver works with the old names regardless

**Immediate guidance (no code)**: AM-1291 on otralingo: implementation is done, so it is no longer `in-progress:running`; the deploy gate is the quality gate: `quality-gate:running` (a deliberate skip of review, noted in the conversation), then `done:success` once deployed; following the workflow strictly means `review:queue` first.
