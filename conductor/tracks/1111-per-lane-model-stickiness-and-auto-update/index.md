# Track 1111: Per-lane model stickiness, correct reset, and auto-update

**Lane**: review
**Lane Status**: running
**Progress**: 100%
**Phase**: All 6 phases complete
**Type**: dev
**Summary**: Populated workflow.json's per-lane primary_model (this project + macrodash/coachai), fixed chat dispatch to follow the track's lane model, extracted+tested the precedence rule, added model-staleness detection/logging, and (Phase 6) opt-in same-tier auto-update triggered by that same staleness check, auditable via git commit.

## Problem

Four related asks, each checked against the actual code rather than
assumed:

1. **Per-lane model, fixed provider (worker stickiness)**: session
   continuity (`--resume`) is Claude-specific (track 1086's
   `track_sessions`) — switching *provider* mid-track loses it; switching
   *model within the same provider* doesn't (already the explicit finding
   in [1096](../1096-worker-cli-model-picker/plan.md)'s Phase 6). The code
   already separates these correctly: `buildCliArgs`
   (`conductor/laneconductor.sync.mjs:4003`) resolves
   `chosenModel = laneConfig.primary_model ?? proj.primary?.model` per
   spawn, while `chosenCli` always comes from the project's fixed
   `primary.cli` — never per-lane. So the STRUCTURE already matches what
   was asked for (plan=opus, implement=sonnet, review=haiku,
   quality-gate=haiku, same provider throughout). **What's actually
   missing: nobody configures `primary_model` per lane.** Verified live:
   `conductor/workflow.json` in the laneconductor repo itself —
   literally this project's own dogfooded config — has `primary_model`
   **missing on all 5 lanes** (plan/implement/review/quality-gate/done).
   The capability exists and is silently unused everywhere.

2. **Set-on-pickup / reset-on-finish**: for **automated lane actions**,
   there is nothing to reset — `chosenModel` is computed fresh on every
   `buildCliArgs` call from the current lane's config, not a persisted
   worker-level field that could go stale. So "starts by setting to the
   lane's model" already happens correctly, and "resets when finished"
   isn't a distinct step because nothing was mutated to begin with.
   Two real gaps found instead:
   - The **chat dispatch path** (`worker_adhoc_chat`/`track_chat`,
     `conductor/laneconductor.sync.mjs:4719-4725`) always uses
     `proj.primary?.model` — even a `track_chat`, which knows exactly
     which track (and therefore which lane) it's scoped to, ignores that
     lane's model entirely. Whether that's correct (a chat isn't "running
     the lane action") or should follow the track's current lane is an
     open design question, not a bug — needs a decision.
   - **[1096](../1096-worker-cli-model-picker/index.md)'s manual "Change
     Model" UI feature** persists an override into `.laneconductor.json`
     via a `set_model` dispatch (`conductor/laneconductor.sync.mjs:4639`).
     Precedence (`laneConfig.primary_model ?? proj.primary?.model`)
     means a per-lane setting always wins over a manual override for
     automated runs — correct in principle, but **never verified with a
     test**, and currently moot everywhere since no project has
     per-lane models configured (see #1).

3. **Workflow files audit**: once #1 has real per-lane models to set,
   every LaneConductor project's `workflow.json` needs those `primary_model`
   fields actually populated (not just schema-capable). Starting point:
   this project's own file, confirmed empty above.

4. **Model version auto-update**: [1099](../1099-dynamic-worker-model-discovery/index.md)
   (done) makes *workers* discover and report available models at
   heartbeat time — it does not touch `workflow.json`'s per-lane
   `primary_model` strings, which will be **hardcoded literal model
   IDs** once #3 populates them (e.g. `"claude-sonnet-4-5"`). When a
   provider ships a new version (`claude-sonnet-4-5` → `claude-sonnet-5`),
   nothing currently notices. Need at least a notification that a
   workflow.json entry is stale relative to what 1099's discovery
   reports as available; ideally an intelligent same-family auto-update
   (bump the version, keep the tier — sonnet stays sonnet) with the
   user able to opt out per project.

## Solution (to be detailed at planning — this file states the verified problem, not the design)

- Populate this project's own `workflow.json` first (dogfood point #3 on
  the config already known to be missing it), before touching other
  projects — gives a concrete example to validate #1/#2 against.
- Decide and test the manual-override-vs-per-lane-model precedence (#2's
  second gap) with a real test, not just code-reading confidence.
- Decide the chat-dispatch model question (#2's first gap) — likely:
  `track_chat` follows the track's current lane's model if set, falls
  back to project default; `worker_adhoc_chat` (no track) always uses
  project default since there's no lane to derive from.
- Design the staleness/auto-update mechanism (#4) on top of 1099's
  existing `available_models` reporting — the discovery data already
  exists per worker; this track's job is comparing it against
  `workflow.json`'s configured strings and acting/notifying.

## Phases
- [ ] Phase 1: Populate `primary_model` per lane in this project's own `workflow.json`, using it to validate the existing precedence logic end-to-end (confirms #1/#2 actually work once configured, not just in theory)
- [ ] Phase 2: Decide + implement the chat-dispatch model question (#2's open design point)
- [ ] Phase 3: Test coverage for manual-override-vs-per-lane-model precedence (#2's second gap) — currently unverified
- [ ] Phase 4: Audit + populate `workflow.json` across other LaneConductor-managed projects (#3) — scope the actual list at planning time
- [ ] Phase 5: Model-version staleness detection + notification, built on 1099's `available_models` (#4)
- [ ] Phase 6: Intelligent same-family auto-update (opt-in/opt-out per project), if Phase 5's notification approach alone isn't judged sufficient

## Depends on
[1096](../1096-worker-cli-model-picker/index.md) — the manual override mechanism (`set_model` dispatch) this track's precedence work interacts with; its own Phase 6 (provider vs. model / session continuity) is the reasoning this track's stickiness requirement is built on.
[1099](../1099-dynamic-worker-model-discovery/index.md) (done) — the model-discovery data Phase 5/6's staleness detection reads from.
[1086](../1086-persistent-track-sessions/index.md) — `track_sessions`/`--resume`, the concrete reason provider must stay fixed while model can vary.

## Notes

Opened directly from a user request with four numbered asks; this index
restates each against verified current code behavior (file:line
references above) rather than assumed behavior, per this session's
established practice of confirming before planning fixes.
**Waiting for reply**: yes
