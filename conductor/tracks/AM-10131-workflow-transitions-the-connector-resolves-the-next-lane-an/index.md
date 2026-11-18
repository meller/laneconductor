# Track AM-10131: Workflow transitions: the connector resolves the next lane and status from workflow.json (legacy and current formats)

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Phase**: Reviewed (pass), shipped on main and released (plugins 1.2.2 and later); every test case checked, TC-14 on a dummy track with otralingo's own lane names (outcome success moved in-progress to review:queue and the board showed it in review).
**Track Kind**: bug
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: Found 2026-11-18 on the otralingo project (track AM-1291, in-progress, running, deploy gate running): the agent planned to finish it as `done:success` while the project's workflow.json says in-progress succeeds into `review`. Two causes.

1. otralingo's `conductor/workflow.json` is the OLD daemon-era format (last changed 2026-04-15): bare lane names as targets (`"on_success": "review"`, `"on_failure": "in-progress"`), `planning` succeeds into `backlog`, and daemon fields (`auto_action`, `parallel_limit`, `max_retries`, `global`, `defaults`). The current format uses `lane:status` targets (`review:queue`, `plan:success`, `implement:failure`). A bare target leaves the status undefined, so the model has to guess (and guessed done:success).
2. Nothing in the tools resolves a transition. In the old world the daemon applied `on_success` and `on_failure`; in the plugin world it is left to the model reading workflow.json, which is the thing that goes wrong.

Do (in the connector, laneconductor-parallel add-on, plus the base text that mentions it):
- A resolver in the connector: given a project's workflow.json and a track's current lane, return the next lane and lane status for an outcome (`success`, `failure`). Normalize legacy bare targets: `review` means `review:queue`; a bare target equal to the current lane means that lane with status `failure` for on_failure and `success` for on_success only when the file says so; document the rule and make it a table in the tests. Unknown or null targets (backlog, done) are returned as 'no automatic move'.
- Expose it: `get_track` and `get_context` carry `valid.next` (`{ success: 'review:queue', failure: 'in-progress:failure' }` for the track's current lane) next to the existing `valid.lanes` and `valid.statuses`; additive fields only.
- `update_track` accepts an optional `outcome: 'success' | 'failure'` (mutually exclusive with `markers` for Lane and Lane Status) that applies the resolved transition and commits it, keeping the base and CONFLICT rules. An outcome that resolves to 'no automatic move' is refused with the reason.
- The skill's lane guides and the base commands (`move`, `implement`, `review`, `quality-gate`, `run`) tell Claude to use `valid.next` or `outcome`, never to compute the target from the raw file; the base text still works without the add-on by reading workflow.json with the documented normalization rule.
- A migration offer, not automatic: `/laneconductor:workflow` can show a legacy workflow.json and offer a non-destructive rewrite to the current format (backup first, ask before writing). Do not touch any project's file without the person's yes.
- Tests: otralingo's real workflow.json (legacy format, lanes planning and in-progress) and our own current default; a custom lane; failure transitions; `outcome` through the stdio server; CONFLICT still wins on a stale base; the base text contains the rule and no 'done:success after implement' wording.

Immediate guidance for AM-1291 (no code needed): when the deploy and post-deploy checks pass, move it to `review` with status `queue`; only the quality gate moves a track to done.
**Summary**: Found 2026-11-18 on the otralingo project (track AM-1291, in-progress, running, deploy gate running): the agent planned to finish it as `done:success` while the project's workflow.json says in-progres
**Verdict**: pass
