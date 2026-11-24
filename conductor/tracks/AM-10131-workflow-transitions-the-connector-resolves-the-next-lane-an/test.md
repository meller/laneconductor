# Tests: Track 10131 (workflow definition and transitions)

Test commands: `cd connector && npm test` (all connector tests), or the files alone with `node --test test/workflow-transitions.test.mjs test/workflow-transitions-parity.test.mjs test/workflow-outcome.test.mjs test/lanes-reference.test.mjs`; `node scripts/build-plugin.mjs --check`; `claude plugin validate --strict` on the three plugins and the marketplace. Do not run worker-spawning or mock-CLI suites from a worktree.

Written BEFORE the code. The implementer writes the failing tests first, then makes them pass. Grammar source: track 1020 (done) and the owner's model in spec.md.

## Resolver (pure function; table-driven; `workflow-transitions.test.mjs`)

Fixtures: (A) otralingo's real older-format workflow.json copied into the test folder (lanes planning, backlog, in-progress, review, quality-gate, done; bare targets); (B) this repository's current default (plan, implement, review, quality-gate, done with `lane:status` targets); (C) a custom workflow with an extra lane and mixed formats.

- [x] TC-1 (A, older format; REQ-1, REQ-2): in-progress success gives review:queue; in-progress failure gives in-progress:failure (bare target equals the current lane); review success gives quality-gate:queue; review failure gives in-progress:queue (a different lane); quality-gate success gives done:queue; quality-gate failure gives in-progress:queue; planning success and failure give backlog:queue; backlog and done give null (no automatic move)
- [x] TC-2 (B, current; REQ-1, REQ-2): plan success gives plan:success (stays); plan failure gives backlog:queue; implement success gives review:queue; implement failure gives implement:failure; review failure gives implement:queue; quality-gate success gives done:queue; quality-gate failure gives plan:queue; done failure gives done:failure
- [x] TC-3 (grammar, 1020; REQ-2): a bare target naming a DIFFERENT lane defaults to `queue`; a bare target naming the SAME lane defaults to `success` for on_success and `failure` for on_failure; an explicit `lane:status` is used as written; a bare `done` from another lane is done:queue, never done:success; a `null` or absent target gives null
- [x] TC-4 (C, custom; REQ-2): a custom lane resolves through the workflow's own keys; mixed formats in one file work; an unknown current lane returns an explicit error (never a guess)
- [x] TC-5 (names; REQ-2): a project that uses the guide names (plan, implement) and one that uses the old names (planning, in-progress) resolve the same logical transitions; `valid.guide_lanes` stays consistent

## ONE LOGIC, TWO CALLERS (the owner's rule; `workflow-transitions.test.mjs`, `workflow-transitions-parity.test.mjs`)

- [x] TC-16 (REQ-3): the connector and the daemon import the SAME module (`conductor/services/workflow-transitions.mjs`); a test fails if either contains its own copy of the transition parsing (for example a grep for the bare-target defaulting code outside the shared module)
- [x] TC-17 (REQ-4): PARITY: the same table (fixtures A, B, C; success and failure for every lane) run through the shared module and through each patched daemon site's helper gives identical lane and status; any case where the OLD daemon behavior differed is listed (D1-D11 in spec.md) and decided by the owner, never changed silently
- [x] TC-18 (REQ-3): the plugin build ships the shared module inside the add-on at the same relative path and it is byte-identical to the source; the installed-layout stdio smoke test (a copy laid out like an installed plugin) still resolves the import
- [x] TC-19 (REQ-10): SAFETY: no daemon process is started, no worker-spawning or mock-CLI suite is run from a worktree, and `ps aux | grep -E 'laneconductor.sync.mjs|lc-connector'` shows no process started by the implementer after the last test run (a process check, no test file)

## Exposure through the connector (`workflow-outcome.test.mjs`)

- [x] TC-6 (REQ-5): `get_track` and `get_context` carry `valid.next` for the track's current lane, additive (existing fields and the envelope unchanged; the existing connector tests still pass untouched)
- [x] TC-7 (REQ-6): `update_track` with `outcome: success` on an in-progress track in fixture A lands in review:queue in ONE commit that touches only that track's index.md (and the generated summary); `outcome: failure` lands in in-progress:failure
- [x] TC-8 (REQ-6): `outcome` together with Lane or Lane Status markers is VALIDATION_FAILED with a hint; an outcome that resolves to null (backlog, done) is refused with the reason; a stale base still gives CONFLICT and nothing is written
- [x] TC-9 (REQ-6): over the real stdio server (SDK client), against a scratch repo whose workflow.json is fixture A: create a track, move it to in-progress with the project's own lane name, `outcome: success`, read it back: lane is review, status is queue; the wrong names `implement` and `in_progress` still give the suggestion from track 10128

## The reference document and the text (`lanes-reference.test.mjs`, `commands.test.mjs`, `plugin-coverage.test.mjs`)

- [x] TC-10 (REQ-8): the canonical reference exists in the skill source and in the generated BASE plugin (Markdown only; the portal-blocking emulation test for the base still passes); it names all five statuses with a meaning each, the two done meanings, the 1020 defaults, that `running` belongs to the lane whose action is executing, that a human's manual move wins, and the old-to-new lane names
- [x] TC-11 (REQ-7, REQ-8): the skill index, `/laneconductor:workflow` and the lane guides link to it; no lane guide or command text says 'done:success after implement' or computes a target from the raw file; the commands that move tracks say to use `valid.next` or `outcome` when the connector is present and 1020's grammar when it is not
- [x] TC-12 (REQ-7, REQ-8): the generator drift test, `docs/plugin-map.md`, the coverage test and `node scripts/build-plugin.mjs --check` pass; `claude plugin validate --strict` passes on all three plugins and on the marketplace

## Real-world check (read-only, run by the implementer and shown in the report)

- [x] TC-13 (REQ-1, REQ-5): run the resolver and `get_track` from the built add-on against the REAL otralingo repository (`<code>/otralingo`, read only: no write tool is called) for track AM-1291 and one planning track: show their `valid.next` and `valid.lanes`; the values match TC-1 (a manual run, no test file)
- [x] TC-14 (HUMAN; REQ-6): in the otralingo session, after updating, finish a real in-progress track with `outcome: success` and see it in review:queue on the board. Done 2026-11-18 with the owner's agreement on a dummy track instead of a real one: a scratch repository holding a copy of otralingo's own workflow.json (planning, in-progress, review), the installed 1.9.0 connector over stdio, create_track, a move to in-progress:running, then update_track with `outcome: success` returned the transition in-progress to review:queue, and the board built for that repository showed the card in the review column.

## Regression

- [x] TC-15: `cd connector && npm test` passes with the new tests included (328 before this track); no hard-coded command count in public text; no process left running
