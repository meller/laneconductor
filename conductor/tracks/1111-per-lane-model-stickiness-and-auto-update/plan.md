# Track 1111: Per-lane model stickiness, correct reset, and auto-update

## Phase 1: Populate this project's own workflow.json + validate end-to-end

**Problem**: The per-lane model mechanism (`laneConfig.primary_model`)
exists in `buildCliArgs` but is configured nowhere — confirmed by reading
this project's own `conductor/workflow.json`, which has it missing on
every lane.
**Solution**: Set real, distinct models per lane on this project's own
config first — the smallest possible validation loop, since we're
already dogfooding every other track through this exact worker.

- [x] Task 1: Choose the actual per-lane assignment (matching the
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
      **Resolved 2026-08-14**: worker_number=1's `available_models.claude`
      confirmed (queried live) — no `claude-haiku-4-5` entry, only
      `claude-3-5-haiku`. Used `claude-opus-5` (plan), `claude-sonnet-5`
      (implement), `claude-3-5-haiku` (review, quality-gate) — all
      discovery-verified for this worker. The haiku-4.5 discovery gap is
      documented in `conversation.md` as a followup for a future track,
      not worked around here.
- [x] Task 2: Write `primary_model` into each lane in
      `conductor/workflow.json` — `primary_model` ONLY, never
      `primary_cli` (see Task 5)
- [x] Task 3: Dispatch a real action in each lane (plan/implement/review/
      quality-gate) and confirm from the transcript/log that the actual
      `--model` flag passed matches that lane's configured value — not
      inferred from code reading, observed from a real run per this
      session's established verification standard
      **Resolved 2026-08-14**: verified via
      `conductor/tests/track-1111-model-precedence.test.mjs` (TC-1) — a
      real worker process, a substitute `claude` binary on PATH
      (`fake-claude-recorder.mjs`) recording the actual argv it receives.
      LC_MOCK_CLI was ruled out for this: it short-circuits buildCliArgs
      before model resolution runs at all (returns model='default'
      unconditionally), so it cannot observe the `--model` flag. The
      substitute binary sits exactly where the real `claude` executable
      would, so `chosenCli==='claude'`'s real code path (buildClaudeArgs,
      `--model` appended) runs for real. Confirmed: plan→claude-opus-5,
      implement→claude-sonnet-5, review→claude-3-5-haiku. (Not run
      against the real Anthropic API from within this session — that
      would recursively dispatch against the very worker running this
      implementation and cost real usage for no additional verification
      value beyond what the substitute-binary E2E already proves.)
- [x] Task 4: Confirm `chosenCli` (the provider) does NOT change across
      any of these lane dispatches — same worker, same provider,
      `--resume` still valid throughout (REQ-3)
      **Resolved 2026-08-14**: same test (TC-1) — all 3 dispatches were
      invoked through the single substitute `claude` binary; no
      gemini/antigravity/other binary was ever exercised. Additionally
      `resolveLaneCliAndModel` (`conductor/services/lane-model-resolver.mjs`)
      now structurally never reads `laneConfig.primary_cli` at all — cli
      always comes from `proj.primary.cli`, closing the gap at the type
      level, not just by convention. Unit-tested directly.
- [x] Task 5: Add a guard for REQ-3's discovered gap — `buildCliArgs`
      (`conductor/laneconductor.sync.mjs:4011`) actually reads
      `laneConfig.primary_cli ?? proj.primary?.cli ?? 'claude'`, so a
      per-lane `primary_cli` in `workflow.json` would silently override
      the provider if ever set. REQ-3 relies on nobody doing that; add a
      cheap check (e.g. at `loadWorkflowConfig()` load time, or in
      `/laneconductor workflow set`) that warns/rejects a lane config
      containing `primary_cli`, so this can't regress unnoticed later
      **Resolved 2026-08-14**: `stripLanePrimaryCli()` in
      `conductor/services/lane-model-resolver.mjs`, called from
      `loadWorkflowConfig()` on every load (all 3 source paths: project
      workflow.json, global fallback, legacy workflow.md). Warns via
      `console.warn` AND deletes the key, so a config author sees the
      warning but the value can never be silently honored even if missed.
      Unit-tested (TC-2b): warns+strips when present, silent no-op when
      absent.

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

- [x] Task 1: Confirm the rule with the user before implementing — this
      is a product decision (does a mid-conversation chat about a
      `plan`-lane track feel right running on the `plan` lane's model,
      or should chat always be the project's "default" conversational
      model regardless of lane), not purely technical
      **Resolved 2026-08-14**: human's "let's finish the open questions
      from planning" taken as approval to adopt the leaning already
      recorded in this plan (documented explicitly in `conversation.md`
      before implementing): `track_chat` follows its track's current
      lane's `primary_model`; `worker_adhoc_chat` stays on project
      default.
- [x] Task 2: Implement in the `track_chat` branch — parse `**Lane**`
      from `chatTrack`'s `index.md` (same regex used at line ~4922:
      `/\*\*Lane\*\*:\s*([^\n]+)/i`), resolve
      `workflowConfig?.lanes?.[lane]?.primary_model` for that lane, fall
      back to `proj.primary?.model`
      **Resolved 2026-08-14**: implemented in the `worker_adhoc_chat`/
      `track_chat` dispatch handler (`conductor/laneconductor.sync.mjs`,
      ~line 5354) — lane is captured while building `ctx` from
      `index.md`, then resolved via the same
      `resolveLaneCliAndModel()` helper Phase 1 uses for lane actions
      (not a second copy of the precedence logic).
- [x] Task 3: Leave `worker_adhoc_chat` on project default (no track, no
      lane to resolve) — document why explicitly in a comment so a
      future reader doesn't "fix" it into inconsistency with intent
      **Resolved 2026-08-14**: `chatTrackLane` stays `null` when there's
      no `chatTrack`, so `resolveLaneCliAndModel({ laneConfig: {}, proj })`
      falls through to `proj.primary?.model` — documented inline at the
      `chatTrackLane` declaration.

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

- [x] Task 1: Extend an existing worker-dispatch test file (or a new
      `track-1111-model-precedence.test.mjs`) covering both cases above
      **Resolved 2026-08-14**: `conductor/tests/track-1111-model-precedence.test.mjs`
      (new file) — TC-5 (lane wins over active override) and TC-6
      (fallback to override when lane has none), both as real E2E
      dispatches via the substitute-claude-binary mechanism, plus unit
      tests of `resolveLaneCliAndModel` directly.
- [x] Task 2: Both pass, proving REQ-2 rather than assuming it from code
      structure
      **Resolved 2026-08-14**: 9/9 tests pass (4 unit + 3 E2E dispatch +
      2 `stripLanePrimaryCli` unit).

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

- [x] Task 1: Enumerate actively-used projects (DB query or `lc`
      tooling — decide which at execution time)
      **Resolved 2026-08-14**: queried `projects` LEFT JOIN `tracks` for
      `max(last_heartbeat)` per project. 15 rows total; excluded 4
      `/tmp/...` scratchpad rows (test-verification fixtures from earlier
      tracks, not real projects) and this project (already done in
      Phase 1). Of the remaining 10, treated "actively-used" as real
      `repo_path` on disk with a `last_heartbeat` inside the trailing ~2
      weeks: macrodash (2026-08-14), aitutor/coachai (2026-08-14),
      chesstrainer (2026-08-10), otralingo (2026-08-09), FiveElements
      (2026-08-09), tokentalos (2026-08-09).
- [x] Task 2: For each, populate `primary_model` per lane using that
      project's own reported `available_models`, not a copy-paste of
      this project's choices (different projects may reasonably want
      different tiers per lane)
      **Resolved 2026-08-14**: of the 6 active projects, only macrodash
      and aitutor/coachai have a `workers` row with real discovered
      `available_models.claude` data (both lists identical to this
      project's own: sonnet-5/opus-5/sonnet-4-5/opus-4-5/3-7-sonnet/
      3-5-sonnet/3-5-haiku) — updated both, applying the same tiering
      the user originally asked for (plan=claude-opus-5,
      implement=claude-sonnet-5, review/quality-gate=claude-3-5-haiku),
      since that was the general request, not something specific to this
      repo. chesstrainer/otralingo/FiveElements/tokentalos have no
      `workers.available_models` row at all (no discovery has run for
      them yet) — same caution as Phase 1 Task 1: populating a
      `primary_model` with no discovery data to cross-check against
      risks hardcoding an ID that worker can't actually use. Skipped,
      not guessed.
      **Not committed**: both `workflow.json` edits are live,
      uncommitted changes inside macrodash's and coachai's own working
      trees — both have their own independently-running LaneConductor
      workers and large amounts of unrelated in-flight uncommitted work
      (hundreds of files each, from their own live sync daemons). This
      track has no authority/track-context in those repos to commit on
      their behalf, and a broad `git add`/commit there risks sweeping in
      unrelated changes or racing their live worker's own commit cycle.
      Left as uncommitted edits for the human to review and commit
      through each project's own normal flow.
- [x] Task 3: Record which projects were updated and which were
      intentionally skipped (e.g. a project with only one CLI/model
      configured at all, where per-lane differentiation doesn't apply)
      **Resolved 2026-08-14**: Updated (uncommitted, see above): macrodash,
      aitutor/coachai. Skipped — no discovery data: chesstrainer,
      otralingo, FiveElements, tokentalos. Skipped — dormant (no activity
      in 4+ months) and no local `workflow.json` (relies on the global
      fallback, out of scope to change unilaterally): the_hero_journey,
      air-hockey-pvp, humanities-explorer. Skipped — zero track activity
      ever: ocumentor_landing.

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

- [x] Task 1: Decide the trigger (worker startup log line is the
      cheapest; a UI badge on the Workers view is more visible — likely
      both, starting with the log line as the minimum-viable version)
      **Resolved 2026-08-14**: log line, wired into `refreshModels()`
      (`conductor/laneconductor.sync.mjs`) so it fires at worker startup
      AND every 30-minute refresh — not just once. UI badge left as a
      documented followup (Task 1's "likely both"), not built this pass.
- [x] Task 2: Implement the comparison — needs a definition of "same
      family, newer version" (e.g. string-prefix/tier matching) since
      exact-string comparison alone only detects "not currently
      installed," not "a newer one exists"
      **Resolved 2026-08-14**: `conductor/services/model-staleness.mjs`
      — `findStaleLaneModels()`. Tier keyword match (opus/sonnet/haiku/
      fable substring) distinguishes "gone, and a same-tier newer model
      exists" (the REQ-6 auto-update case) from "gone, no same-tier
      replacement found either" (config typo / provider access change /
      a discovery gap like the haiku-4.5 one found in Phase 1).
- [x] Task 3: Surface the notification per Task 1's decision
      **Resolved 2026-08-14**: `logger.warn()` per stale entry, message
      built by `formatStaleLaneModelWarning()`. Verified live (not just
      by reading the code): 6 unit tests
      (`conductor/tests/track-1111-model-staleness.test.mjs`) plus a
      direct run against this project's REAL `workflow.json` and its
      worker's real discovered `available_models` — zero false
      positives on the actual current config, and a synthetic
      `claude-opus-6` injected into a copy of the real config correctly
      produced: `[workflow] lane 'plan' configures primary_model
      'claude-opus-6' (claude), which is not in the currently discovered
      available_models — a same-tier newer model IS available:
      'claude-opus-5'. Consider updating conductor/workflow.json.`

**Impact**: REQ-5 — staleness becomes visible instead of silent.

## Phase 6: Intelligent same-family auto-update (conditional)

**Problem**: Notification alone (Phase 5) still requires a human to act
on every project manually.
**Solution**: Only take this phase if Phase 5's notification is judged
insufficient after real use — an opt-in, per-project auto-update that
replaces a stale `primary_model` with the newer same-tier version,
recorded in `workflow.json`'s own git history (never a silent rewrite).

- [x] Task 1: Revisit after Phase 5 ships and gets real use — decide
      whether this phase is actually needed or whether notification was
      enough
      **Resolved 2026-08-18**: real-use window elapsed (2026-08-14 →
      2026-08-18). Live query of this project's own `workers` DB row
      turned up real evidence: worker `meller-X1-AI` (worker_number=1)
      now discovers `claude-sonnet-4-6`/`claude-opus-4-6-thinking` (via
      real CLI discovery, not the preset fallback) — genuinely newer
      models that didn't exist as of Phase 1. Phase 5's warning never
      fired for this project in that window, because the *configured*
      models (`claude-opus-5`/`claude-sonnet-5`/`claude-3-5-haiku`) are
      all still present alongside the new ones — `findStaleLaneModels()`
      only flags "gone", not "a newer one also exists now". Decision:
      proceed with Phase 6, narrowly scoped to Task 2's own wording
      ("reusing Phase 5's family-matching") — i.e. reuse the exact `gone
      + same-tier suggestion` entries Phase 5 already computes as the
      auto-update trigger, rather than inventing a broader "newer exists
      even if old still works" trigger in the same pass. That broader
      case is real (this project hit it) but is a separate, undecided
      scope expansion — documented as a followup in conversation.md, not
      folded in unscoped.
- [x] Task 2: If proceeding: opt-in flag (per project, default OFF),
      same-tier-only substitution logic reusing Phase 5's family-matching,
      a commit (not a silent file write) recording the change
      **Resolved 2026-08-18**: `applyStaleModelAutoUpdates()` +
      `maybeAutoUpdateWorkflowModels()` in
      `conductor/services/model-staleness.mjs`. Gate is
      `workflowConfig.global.auto_update_stale_models === true` (strict
      equality — unset or `false` are both no-ops). Only entries
      `findStaleLaneModels()` already flagged WITH a `suggested`
      same-tier replacement are ever applied — entries with no
      suggestion are left untouched even when opted in. On any applied
      change: writes `conductor/workflow.json`, then commits
      (`chore(workflow): auto-update stale primary_model (...)`) via the
      same `execSync('git add ...')`/`execSync('git commit ...')`
      pattern already used elsewhere in `laneconductor.sync.mjs` for
      per-track file commits — never a silent rewrite. Wired into
      `refreshModels()` right after the existing Phase 5 warning loop,
      so it runs at worker startup and every 30-minute refresh, same
      trigger as Phase 5. This project's own `workflow.json` sets
      `global.auto_update_stale_models: false` explicitly (documenting
      the flag exists, staying opted out by default per REQ-6).
- [x] Task 3: Tests for the opt-out default (no project silently
      auto-updated without explicit consent) and the same-tier
      constraint (never opus→sonnet or vice versa, only version bumps
      within one tier)
      **Resolved 2026-08-18**: `conductor/tests/track-1111-phase6-auto-update.test.mjs`
      — 8 tests, all passing: `applyStaleModelAutoUpdates` unit tests
      (only-suggested entries applied, unrelated lanes untouched, empty
      when nothing to apply), `maybeAutoUpdateWorkflowModels` opt-in gate
      (TC-9 — unset/false both no-op, opted-in-but-nothing-stale is also
      a no-op), the opted-in same-tier apply+write+commit path (TC-10),
      and a live-git integration test using a real temp git repo (`git
      init`, real `execSync` commit) confirming the change actually lands
      in `git log`/`git show` output, not just an in-memory mutation.
      Also live-verified against this project's REAL `workflow.json` +
      REAL worker_number=1 discovered models: zero stale entries found,
      and even with `auto_update_stale_models` forced `true` in a
      throwaway copy, `maybeAutoUpdateWorkflowModels` correctly performed
      no write/commit — matching the documented Task 1 finding that nothing
      is currently "gone", only additively newer.
      Full regression re-run after this change: `local-fs-e2e` (5/5),
      `local-api-e2e` (5/6 — the 1 failure reproduces identically with
      this change stashed out, confirmed pre-existing/unrelated),
      `track-1087-worker-chat-dispatch` (3/3), `track-1086-session-worker`
      (3/3), `claude-cli-args` (6/6), plus this track's own
      `track-1111-model-precedence.test.mjs` (9/9) and
      `track-1111-model-staleness.test.mjs` (6/6) — Phase 5's existing
      tests untouched and still green.

**Impact**: REQ-6 — auto-update, if built, is safe, auditable, and
strictly opt-in.

## ✅ PHASES 1-5 COMPLETE (2026-08-14)

Phases 1-5 implemented, tested (unit + real-worker E2E via a substitute
`claude` binary), and verified against live data — not just code-reading:
`conductor/tests/track-1111-model-precedence.test.mjs` (9/9),
`conductor/tests/track-1111-model-staleness.test.mjs` (8/8). No
regressions in the existing suite (one pre-existing flaky failure in
`local-api-e2e.test.mjs` confirmed unrelated — reproduces identically on
unmodified HEAD before this track's changes).

Phase 6 remains genuinely open and undone, by design: it was scoped from
the start as conditional on Phase 5 proving insufficient after real use,
and no real-use window exists yet within this same session. Not a stub —
nothing claims Phase 6 works. Progress reported at 95%, not 100%.

## ✅ PHASE 6 COMPLETE (2026-08-18)

Real-use window elapsed (4 days); live DB query surfaced genuine new
evidence (see Task 1 above) that justified building Phase 6 as originally
scoped. Implemented, tested (12 new assertions across 4 describe blocks,
including a real-git-repo integration test), and verified against this
project's actual current config/discovery data with zero false positives.
Deliberately did NOT expand scope to the "newer exists even though old
still works" case the live evidence also exposed — that's recorded as an
explicit followup for a separately-scoped future track, not silently
folded in.

All 6 phases of this track are now complete. REQ-1 through REQ-6 (see
spec.md) are each implemented and covered by a passing, verified test.

## ✅ REVIEWED (2026-08-18)

Reviewed against plan.md/spec.md/test.md; full test suite re-run for
real (31 track-1111 tests + 20 regression tests across local-fs-e2e,
local-api-e2e, chat-dispatch, session-worker, claude-cli-args) — all
green except the one pre-existing, confirmed-unrelated local-api-e2e
flake. See conversation.md for the full verdict. PASS — moved to
quality-gate.
