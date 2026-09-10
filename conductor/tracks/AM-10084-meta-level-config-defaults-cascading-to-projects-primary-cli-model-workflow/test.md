# Tests: Track AM-10084 — Meta-Level Config Defaults Cascading to Projects

## Test Commands

```bash
# New/extended pure-logic unit tests (zero deps, spawns nothing)
node --test conductor/tests/track-10084-meta-defaults.test.mjs
node --test conductor/tests/track-10069-setup-gaps.test.mjs   # extended in-place, or a sibling track-10084-setup-gaps.test.mjs

# Existing config-loading integration coverage that must not regress
node --test conductor/tests/local-fs-e2e.test.mjs
node --test conductor/tests/local-api-e2e.test.mjs

# UI/server-side (if ui/server/index.mjs's gap route is touched)
cd ui && npx vitest run
```

## Test Cases

### Phase 1: `conductor/services/meta-defaults.mjs`

- [x] TC-1.1: `loadMetaDefaults()` with no `meta-defaults.json` on disk at
      `META_PROJECT_REPO_PATH` — returns `{}`, does not throw.
- [x] TC-1.2: `loadMetaDefaults()` with a malformed JSON file — returns `{}`,
      does not throw, matches `conductor/defaults.json`'s existing
      warn-and-continue behavior.
- [x] TC-1.3: `loadMetaDefaults()` with a valid file — returns the parsed
      object unchanged.
- [x] TC-1.4: `mergeEffectivePrimary` — CLI flag override wins over every
      other tier even when project config, project defaults, and meta
      defaults all disagree.
- [x] TC-1.5: `mergeEffectivePrimary` — project's own `.laneconductor.json`
      wins over project's own `conductor/defaults.json`, meta defaults, and
      hardcoded, when no CLI flag is given.
- [x] TC-1.6: `mergeEffectivePrimary` — project's own `conductor/defaults.json`
      wins over meta defaults and hardcoded, when project config is silent.
- [x] TC-1.7: `mergeEffectivePrimary` — meta defaults win over hardcoded when
      every project-level tier is silent.
- [x] TC-1.8: `mergeEffectivePrimary` — hardcoded `'claude'` is the result
      when every tier including meta defaults is silent.
- [x] TC-1.9: `mergeEffectivePrimary` with `inheritMetaDefaults: false` —
      meta defaults tier is skipped entirely even when it has a value;
      result falls through straight to hardcoded (assuming project tiers are
      silent).
- [x] TC-1.10: `mergeWorkflowConfig` — project's `conductor/workflow.json`
      overriding only `lanes.review.max_retries` still yields every other
      lane's settings from the meta `workflow` block.
- [x] TC-1.11: `mergeWorkflowConfig` — for a lane meta doesn't mention at all,
      falls through to `globalCanonicalWorkflow`'s value for that lane.
- [x] TC-1.12: `mergeWorkflowConfig` — project's own value for a given
      lane+key always wins over the same lane+key in meta defaults, even
      when both are set.
- [x] TC-1.13: `mergeWorkflowConfig` with `inheritMetaDefaults: false` —
      output is identical to a merge with `metaWorkflow` omitted entirely
      (meta tier fully skipped, straight to global-canonical).

### Phase 2/3: sync worker + `bin/lc.mjs` wiring

- [x] TC-2.1: With `conductor/meta-defaults.json` present at
      `META_PROJECT_REPO_PATH` setting `project.primary.cli: "claude"`, and
      a test project with no `primary.cli` set anywhere in its own config —
      start the worker (or call its config-resolution path directly) and
      confirm the resolved `config.project.primary.cli === 'claude'`.
- [x] TC-2.2: Same setup, but the test project's own `.laneconductor.json`
      sets `primary.cli: "antigravity"` — confirm the resolved value is
      `'antigravity'`, not the meta default.
- [x] TC-2.3: Same setup, but the test project sets
      `project.inherit_meta_defaults: false` and has no `primary.cli` of its
      own — confirm the resolved value falls through to the hardcoded
      `'claude'` fallback, not the meta default (which is also `'claude'`
      here by coincidence — use a *different* meta-default CLI value in this
      specific test, e.g. `'antigravity'`, so a bug that ignored the opt-out
      flag would be caught rather than accidentally passing).
- [~] TC-2.4: Touching `conductor/workflow.json` while the worker is running
      (existing chokidar reload path) re-runs the merge — not independently
      exercised live (the watcher's `.on('change', ...)` handler calls the
      exact same `loadWorkflowConfig()` reference verified by TC-2.1-2.3 and
      the Phase 1 `mergeWorkflowConfig` unit tests, so risk is low, but this
      specific reload trigger path itself was not spawned-and-touched).
- [x] TC-2.5: `lc workflow` (bin/lc.mjs's display command) prints the same
      *effective* per-lane values the worker's own `loadWorkflowConfig()`
      would compute for the same project — not just whichever single file
      `bin/lc.mjs` happens to read first.
- [x] TC-2.6: `lc state --json`'s reported primary CLI for a project with no
      local override matches the meta default, matching TC-2.1's worker-side
      result — confirms `bin/lc.mjs` and `laneconductor.sync.mjs` agree.

### Phase 4: `setup-gaps.mjs`

- [x] TC-4.1 (parity): every existing test in
      `conductor/tests/track-10069-setup-gaps.test.mjs` still passes
      unmodified, called both with and without the two new params supplied —
      confirms the default (`workerMode: 'dedicated'`) path is byte-for-byte
      unchanged.
- [x] TC-4.2: `workerMode: 'manager-driven'`, `hasOnlineWorker: false`,
      everything else from the `FULLY_CONFIGURED` fixture — output contains
      `{ id: 'manager-driven-no-worker', severity: 'advisory' }`, does NOT
      contain a `blocking` gap.
- [x] TC-4.3: `workerMode: 'manager-driven'`, `primaryProviderReachable:
      false`, `primaryProviderReachableAnywhere: true`, everything else from
      `FULLY_CONFIGURED` — output does NOT contain `no-provider`.
- [x] TC-4.4: `workerMode: 'manager-driven'`, `primaryProviderReachable:
      false`, `primaryProviderReachableAnywhere: false` — output DOES still
      contain `{ id: 'no-provider', severity: 'blocking' }` (no free pass
      with zero evidence anywhere on the instance).
- [x] TC-4.5: `workerMode: 'dedicated'` (explicit, not defaulted),
      `primaryProviderReachable: false`, `primaryProviderReachableAnywhere:
      true` — output DOES still contain `no-provider` — the cross-project
      inheritance only ever applies to `manager-driven` projects, never to
      `dedicated` ones, regardless of what's reachable elsewhere.

### Phase 5: call-site wiring (integration)

- [x] TC-5.1: `GET /api/state?project_id=<livingwork-like-fixture>` against
      a test project configured `worker_mode: manager-driven` in its
      `.laneconductor.json` on disk, with a `provider_status` row for a
      *different* project_id showing `claude`/`available` — response's
      `gaps` array does not contain a blocking `no-workers` or `no-provider`
      entry for that project.
- [x] TC-5.2: Same fixture but with zero `provider_status` rows for `claude`
      anywhere in the DB — response's `gaps` DOES contain blocking
      `no-provider`.
- [x] TC-5.3 (manual, real instance): livingwork's actual
      `.laneconductor.json` set to `worker_mode: manager-driven`; confirm in
      the real running Kanban dashboard (not just a test fixture) that its
      setup gaps no longer show `no-workers`/`no-provider` as blocking,
      given `claude` is independently verified reachable by at least one
      other real project's worker on this machine. This is the literal
      incident that motivated this track — must be checked against the real
      instance before calling the track done.

## Acceptance Criteria

- [x] All automated test cases above pass (TC-2.4 is the one partial
      exception — see its own note; everything else fully verified).
- [x] TC-5.3's manual real-instance check performed and its observed result
      recorded in `conversation.md`: livingwork's `/api/state?project_id=4560`
      went from `[{id: 'no-provider', severity: 'blocking'}]` to `[]` after
      setting `worker_mode: manager-driven` in its real `.laneconductor.json`,
      verified against the real Postgres DB.
- [x] No regressions in `conductor/tests/track-10069-setup-gaps.test.mjs`'s
      original assertions (11/11 still pass).
- [x] `conductor/workflow.md` updated and accurate against the shipped
      behavior (field names, default values, precedence order all match).
