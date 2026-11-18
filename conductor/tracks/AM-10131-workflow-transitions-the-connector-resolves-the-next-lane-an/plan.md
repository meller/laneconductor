# Track 10131: Workflow transitions: the connector resolves the next lane and status from workflow.json

## The model (owner, 2026-11-18): lane and lane status are different things

- LANE is where the track sits: planning (or plan), in-progress (or implement), review, quality-gate, done, plus backlog.
- LANE STATUS is the state of the work inside that lane: `queue` (waiting to start), `running`, `success`, `failure`, `waiting`.
- A lane action finishing is a STATUS event first (running to success or failure); the workflow's `on_success` and `on_failure` then say where the card goes: another lane with a status (`review:queue`), or the same lane with a status (`plan:success`, `implement:failure`).
- `done` has two meanings: `done:queue` = passed the quality gate, not shipped yet; `done:success` = shipped (merged or deployed). A bare `done` target therefore means `done:queue`, never `done:success`.
- A human's manual move always wins over the workflow (a deliberate shortcut such as finishing a deploy track straight to `done:success` is allowed); the agent says so in the track's conversation.
- Legacy files use bare lane names as targets (`"on_success": "review"`). Normalization rule: a bare target means that lane with status `queue`, except `done` which means `done:queue`; a bare target equal to the current lane in `on_failure` means that lane with status `failure`. Targets of `null` mean no automatic move. Write this as a table in the tests and in the skill text.

## Phase 1: The resolver

- [ ] Task 1: A pure function in the connector: (workflow.json, current lane, outcome) to `{ lane, status } | null`, with the normalization above; works for the legacy format and the current `lane:status` format
- [ ] Task 2: Table-driven tests: otralingo's real workflow.json (planning, in-progress), our current default, a custom lane, success and failure for every lane, null targets, unknown lanes

## Phase 2: Expose it

- [ ] Task 1: `get_track` and `get_context` carry `valid.next` for the track's current lane (additive)
- [ ] Task 2: `update_track` accepts `outcome: success | failure` (mutually exclusive with Lane and Lane Status markers), applies the resolved transition in one commit, keeps the base and CONFLICT rules; a null transition is refused with the reason
- [ ] Task 3: stdio smoke test with an otralingo-style workflow.json: outcome success on an in-progress track lands in review:queue

## Phase 3: The text

- [ ] Task 1: Lane guides and the base commands (`move`, `implement`, `review`, `quality-gate`, `run`) say: use `valid.next` or `outcome`, do not compute targets from the raw file; without the add-on read workflow.json with the normalization rule; explain lane versus lane status and the two done statuses in one short paragraph; a human's manual move wins and must be noted
- [ ] Task 2: A test that no generated text says 'done:success after implement' and that the paragraph is present

## Phase 4: Migration offer (not automatic)

- [ ] Task 1: `/laneconductor:workflow` shows a legacy workflow.json and offers a non-destructive rewrite to the current format (backup first, ask before writing); never touches a project's file without a yes

**Immediate guidance (no code)**: AM-1291 on otralingo is `in-progress:running` while its deploy gate runs; when the owner wants the deploy to finish it, `done:success` is allowed as a deliberate manual move (say so in the conversation); following the workflow strictly means `review:queue`.
