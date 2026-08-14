# Track 1111: Per-lane model stickiness, correct reset, and auto-update

## Phase 1: Populate this project's own workflow.json + validate end-to-end

**Problem**: The per-lane model mechanism (`laneConfig.primary_model`)
exists in `buildCliArgs` but is configured nowhere — confirmed by reading
this project's own `conductor/workflow.json`, which has it missing on
every lane.
**Solution**: Set real, distinct models per lane on this project's own
config first — the smallest possible validation loop, since we're
already dogfooding every other track through this exact worker.

- [ ] Task 1: Choose the actual per-lane assignment (matching the
      user's example: plan=opus-tier, implement=sonnet-tier,
      review=haiku-tier, quality-gate=haiku-tier) using real current
      model IDs — cross-check against this project's own
      `available_models`. **Verified live 2026-08-13**: this is a
      per-worker `workers.available_models` JSONB column (Postgres,
      populated by 1099's heartbeat discovery), not a file — query it via
      `SELECT hostname, worker_number, available_models FROM workers
      WHERE project_id = 1`. This project's active worker (`meller-X1-AI`,
      worker_number 1) currently reports for `claude`: `claude-sonnet-5`,
      `claude-opus-5`, `claude-sonnet-4-5`, `claude-opus-4-5`,
      `claude-3-7-sonnet`, `claude-3-5-sonnet`, `claude-3-5-haiku`. Note:
      there is no `claude-haiku-4-5`-family entry in this list at all —
      `claude-3-5-haiku` is the only haiku-tier option currently
      discovered, so confirm at execution time whether that's genuinely
      the best available haiku-tier model or whether 1099's discovery is
      itself lagging the CLI's real capability before hardcoding it.
      (Also note: a second worker row for this same project reports a
      different, larger model list — pick the worker that will actually
      run these dispatches, don't average across workers.)
- [ ] Task 2: Write `primary_model` into each lane in
      `conductor/workflow.json` — `primary_model` ONLY, never
      `primary_cli` (see Task 5)
- [ ] Task 3: Dispatch a real action in each lane (plan/implement/review/
      quality-gate) and confirm from the transcript/log that the actual
      `--model` flag passed matches that lane's configured value — not
      inferred from code reading, observed from a real run per this
      session's established verification standard
- [ ] Task 4: Confirm `chosenCli` (the provider) does NOT change across
      any of these lane dispatches — same worker, same provider,
      `--resume` still valid throughout (REQ-3)
- [ ] Task 5: Add a guard for REQ-3's discovered gap — `buildCliArgs`
      (`conductor/laneconductor.sync.mjs:4011`) actually reads
      `laneConfig.primary_cli ?? proj.primary?.cli ?? 'claude'`, so a
      per-lane `primary_cli` in `workflow.json` would silently override
      the provider if ever set. REQ-3 relies on nobody doing that; add a
      cheap check (e.g. at `loadWorkflowConfig()` load time, or in
      `/laneconductor workflow set`) that warns/rejects a lane config
      containing `primary_cli`, so this can't regress unnoticed later

**Impact**: Proves the existing mechanism actually works once configured,
on live data, before extending it further, and closes the one structural
gap discovered while re-verifying the code during this planning pass.

## Phase 2: Chat dispatch model resolution — decide, then implement

**Problem**: `worker_adhoc_chat`/`track_chat` always use
`proj.primary?.model`, ignoring the scoped track's current lane even
when `track_chat` clearly knows it. **Verified live 2026-08-13**: the
handler is at `conductor/laneconductor.sync.mjs:4769` (block comment
starting "Track 1087 Phase 8"); the actual resolution is at ~4809-4813:
`cmd = proj.primary?.cli || 'claude'` and
`if (cmd === 'claude' && proj.primary?.model) cliArgs.push('--model',
proj.primary.model)` — no lane lookup at all, confirming the gap exactly
as described.
**Solution**: Decide the rule (leaning `track_chat` follows the track's
current lane's `primary_model` when set, falls back to project default
otherwise; `worker_adhoc_chat` always uses project default — no lane to
derive from) and implement it in the chat dispatch handler. The lookup
mechanism already exists elsewhere in this file and should be reused
verbatim: normal lane dispatch resolves
`laneConfig = workflowConfig?.lanes?.[lane_status] ?? {}` (line ~4926)
where `lane_status` comes from parsing `**Lane**:` out of the track's
`index.md`, and `workflowConfig` is the cached result of
`loadWorkflowConfig()` (line 963, hot-reloaded on `workflow.json`
changes). `track_chat` already has `chatTrack` resolved — Task 2 just
needs to read that track's `index.md` `**Lane**` marker the same way the
lane-action dispatch path does, then index into `workflowConfig.lanes`.

- [ ] Task 1: Confirm the rule with the user before implementing — this
      is a product decision (does a mid-conversation chat about a
      `plan`-lane track feel right running on the `plan` lane's model,
      or should chat always be the project's "default" conversational
      model regardless of lane), not purely technical
- [ ] Task 2: Implement in the `track_chat` branch — parse `**Lane**`
      from `chatTrack`'s `index.md` (same regex used at line ~4922:
      `/\*\*Lane\*\*:\s*([^\n]+)/i`), resolve
      `workflowConfig?.lanes?.[lane]?.primary_model` for that lane, fall
      back to `proj.primary?.model`
- [ ] Task 3: Leave `worker_adhoc_chat` on project default (no track, no
      lane to resolve) — document why explicitly in a comment so a
      future reader doesn't "fix" it into inconsistency with intent

**Impact**: REQ-4 — the chat path's model behavior becomes a documented
decision instead of an unexamined default.

## Phase 3: Test — manual override vs. per-lane model precedence

**Problem**: `laneConfig.primary_model ?? proj.primary?.model` has never
been tested — only read and trusted.
**Solution**: A real test: set a per-worker manual override (via 1096's
`set_model` dispatch, which persists into `.laneconductor.json`), then
dispatch a lane action for a lane THAT HAS a configured `primary_model`
— confirm the lane's model wins, not the manual override. Then a second
case: a lane with NO configured `primary_model` — confirm the manual
override is what's used (correct fallback).

- [ ] Task 1: Extend an existing worker-dispatch test file (or a new
      `track-1111-model-precedence.test.mjs`) covering both cases above
- [ ] Task 2: Both pass, proving REQ-2 rather than assuming it from code
      structure

**Impact**: The precedence rule this whole track depends on is now
verified, not just plausible.

## Phase 4: Audit + populate workflow.json across other projects

**Problem**: Point #3 — other actively-used LaneConductor projects
likely have the same gap (missing per-lane `primary_model`) this
project's own file had.
**Solution**: Scope the actual project list at the start of this phase
(which repos are actively LaneConductor-managed on this machine/account
— check via the DB `projects` table rather than guessing), then apply
Phase 1's same pattern to each.

- [ ] Task 1: Enumerate actively-used projects (DB query or `lc`
      tooling — decide which at execution time)
- [ ] Task 2: For each, populate `primary_model` per lane using that
      project's own reported `available_models`, not a copy-paste of
      this project's choices (different projects may reasonably want
      different tiers per lane)
- [ ] Task 3: Record which projects were updated and which were
      intentionally skipped (e.g. a project with only one CLI/model
      configured at all, where per-lane differentiation doesn't apply)

**Impact**: REQ-1 satisfied beyond just this project.

## Phase 5: Model-version staleness detection

**Problem**: Once `workflow.json` has real hardcoded model ID strings
(post Phase 1/4), nothing notices when a provider ships a newer version
and that string becomes stale — despite 1099 already knowing the current
`available_models` per worker.
**Solution**: A check — run at a sensible trigger point (worker startup,
or periodically alongside heartbeat) — comparing each lane's configured
`primary_model` against that provider's latest `available_models` entry
reported by 1099's discovery. Surface a mismatch somewhere a human will
actually see it.

- [ ] Task 1: Decide the trigger (worker startup log line is the
      cheapest; a UI badge on the Workers view is more visible — likely
      both, starting with the log line as the minimum-viable version)
- [ ] Task 2: Implement the comparison — needs a definition of "same
      family, newer version" (e.g. string-prefix/tier matching) since
      exact-string comparison alone only detects "not currently
      installed," not "a newer one exists"
- [ ] Task 3: Surface the notification per Task 1's decision

**Impact**: REQ-5 — staleness becomes visible instead of silent.

## Phase 6: Intelligent same-family auto-update (conditional)

**Problem**: Notification alone (Phase 5) still requires a human to act
on every project manually.
**Solution**: Only take this phase if Phase 5's notification is judged
insufficient after real use — an opt-in, per-project auto-update that
replaces a stale `primary_model` with the newer same-tier version,
recorded in `workflow.json`'s own git history (never a silent rewrite).

- [ ] Task 1: Revisit after Phase 5 ships and gets real use — decide
      whether this phase is actually needed or whether notification was
      enough
- [ ] Task 2: If proceeding: opt-in flag (per project, default OFF),
      same-tier-only substitution logic reusing Phase 5's family-matching,
      a commit (not a silent file write) recording the change
- [ ] Task 3: Tests for the opt-out default (no project silently
      auto-updated without explicit consent) and the same-tier
      constraint (never opus→sonnet or vice versa, only version bumps
      within one tier)

**Impact**: REQ-6 — auto-update, if built, is safe, auditable, and
strictly opt-in.
