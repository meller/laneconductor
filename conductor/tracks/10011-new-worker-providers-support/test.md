# Tests: Track 10011 — New Worker Providers Support

## Test Commands
```bash
# Node-side tests (registry, sync worker, CLI wizard logic)
node --test conductor/tests/providers.test.mjs
node --test conductor/tests/providers-sync.test.mjs   # only if Phase 1 needed a mirrored file

# UI unit/integration tests
cd ui && npm test

# Full worker E2E (existing suites — must still pass, no regressions)
node --test conductor/tests/local-fs-e2e.test.mjs
node --test conductor/tests/local-api-e2e.test.mjs
```

## Test Cases

### Phase 1: Canonical Provider Registry
- [x] TC-1: `normalizeProviderId('agy')` returns `'antigravity'`.
- [x] TC-2: `normalizeProviderId('claude')` returns `'claude'` (already canonical, no-op).
- [x] TC-3: `normalizeProviderId('some-future-provider')` returns the input
      unchanged (unrecognized ids pass through rather than throwing).
- [x] TC-4: `PROVIDER_IDS` equals `['claude', 'gemini', 'copilot', 'antigravity']`
      (order used to drive UI dropdown rendering).
- [x] TC-5: `providerIcon('antigravity')` and `providerIcon('agy')` return
      the same icon (alias resolves before lookup).
- [x] TC-6: `providerIcon('unknown-id')` returns the generic fallback (🤖),
      not undefined/throw.
- [x] TC-7: `defaultModelFor('gemini')` returns the first entry of
      `PROVIDERS.gemini.models`, not any other provider's model id.
- [x] TC-8: `defaultModelFor('unknown-id')` returns `null`.
- [x] TC-9: N/A — Phase 1's spike built cleanly with a direct import from
      `ui/src/`, so no mirrored file exists to test for drift.

### Phase 2: Node-side consumers
- [ ] TC-10: Running `lc setup`'s agent-selection step and choosing
      Antigravity writes `"cli": "antigravity"` into `.laneconductor.json`
      — not `"agy"`. Not automated (interactive wizard); verified by code
      review of `bin/lc.mjs`'s new `normalizeProviderId(agentMap[...])` write
      path and `node --check bin/lc.mjs`.
- [ ] TC-11: `conductor/laneconductor.sync.mjs`'s `discoverAvailableModels('agy')`
      (legacy config) resolves and discovers Antigravity's models, same as
      calling it with `'antigravity'`. Not automated (would need to mock
      `child_process.exec` inside the sync worker module); verified by code
      review — `cli = normalizeProviderId(cli)` runs before the
      `cli === 'antigravity'` branch check.
- [ ] TC-12: Gemini model discovery (mocked exec) no longer invokes
      `agy models` as its primary path. Not automated; verified by code
      review — the `agy models` call was deleted from the gemini branch
      entirely (`conductor/laneconductor.sync.mjs`).
- [x] TC-13: `PATCH /api/workers/:id/config` with `{ cli: 'agy' }` succeeds
      and the stored row reads `cli: 'antigravity'` (normalized on write).
- [x] TC-14: `POST /worker/register` (and the heartbeat PATCH path) with a
      legacy `'agy'` cli value stores `'antigravity'` in the `workers` table.
- [x] TC-15: `POST /track/:num/comment` with `author: 'antigravity'` is
      accepted and persisted as `'antigravity'` (previously downgraded to
      `'human'`).
- [x] TC-16: `POST /track/:num/comment` with `author: 'copilot'` is
      accepted and persisted as `'copilot'`.

### Phase 3: UI display fixes
- [x] TC-17: `WorkersList.jsx` grid layout, worker `{ cli: 'gemini', model: null }`
      — rendered model badge text does not equal `'claude-3-5-sonnet'` and
      does not contain the word "claude".
- [x] TC-18: `WorkersList.jsx` strip layout — same assertion as TC-17.
- [x] TC-19: `WorkersList.jsx`, worker `{ cli: 'copilot', model: null }` —
      renders the Copilot icon, not the generic 🤖 fallback.
- [ ] TC-20: `TrackCard.jsx`'s `AgentBadge` for `track.primary_cli === 'antigravity'`
      renders the Antigravity label/icon. Not automated (full `TrackCard`
      render needs a large `track` prop + several callbacks); verified by
      code review — `AgentBadge` now resolves via `providerLabel`/registry
      color map instead of the old 2-entry `AGENT_LABELS` object.
- [ ] TC-21: `TrackDetailPanel.jsx`'s `CommentBubble` for
      `comment.author === 'copilot'` renders with a Copilot-specific style.
      Not automated (component needs `projectId`/`trackNumber` + detail
      fetch mocking); verified by code review — `authorStyle()` resolves
      any `PROVIDER_AUTHOR_COLORS` entry, not just claude/gemini.
- [x] TC-22: `ProjectConfigSettings.jsx` primary CLI `<select>` contains
      options with values `claude`, `gemini`, `copilot`, `antigravity`.
- [x] TC-23: `ProjectConfigSettings.jsx` secondary CLI `<select>` — same as TC-22.

### Phase 4: Provider choice when starting a new worker
- [ ] TC-24: `TrackDetailPanel.jsx`, project has at least one available
      manager worker — selecting `+ New worker…` opens `ProvisionWorkerModal`.
      Not automated (heavy component to mount); verified by code review —
      the dropdown's `onChange` and `resolveWorkerId()` both branch on
      `availableManagers.length > 0` before ever calling `handleStartNewWorker`.
- [ ] TC-25: `TrackDetailPanel.jsx`, project has no manager worker —
      selecting `+ New worker…` shows an inline provider/model picker
      before any worker is started. Same not-automated caveat as TC-24.
- [x] TC-26: `POST /api/projects/:id/workers/start-new` with body
      `{ cli: 'gemini', model: 'gemini-2.5-pro' }` invokes
      `lc start --worker-number N --cli gemini --model gemini-2.5-pro`.
- [x] TC-27: `POST /api/projects/:id/workers/start-new` with no body
      (existing callers) still invokes plain `lc start --worker-number N`
      — no regression for callers that don't pass a provider.
- [ ] TC-28: `lc start --cli gemini --model gemini-2.5-pro` registers the
      worker with `cli: 'gemini', model: 'gemini-2.5-pro'` regardless of
      `.laneconductor.json`'s `project.primary.cli`. Not automated (would
      need a dedicated worker-process E2E spawn, same pattern as
      `local-fs-e2e.test.mjs`); verified by code review + `node --check`
      — `bin/lc.mjs` forwards `--cli`/`--model` into `syncArgs`, and
      `laneconductor.sync.mjs` overrides `config.project.primary` in-memory
      before `getProject()` is ever read.
- [ ] TC-29: `lc start` with no `--cli` flag (existing behavior) still uses
      `project.primary.cli` from `.laneconductor.json`. Same not-automated
      caveat as TC-28 — the override block is a no-op when neither flag is
      passed (`if (cliOverride || modelOverride)`).

## Acceptance Criteria
- [x] All unit tests pass (`node --test`, `cd ui && npm test`) — 10/10
      (`conductor/tests/providers.test.mjs`) + 295 passing in `cd ui && npx
      vitest run` (the same 11 pre-existing failures as the base branch,
      confirmed via `git stash`; none are new).
- [x] No regressions in existing worker E2E suites
      (`local-fs-e2e.test.mjs`: 5/5 pass; `local-api-e2e.test.mjs`: 5/6 pass
      — the 1 failure (`on_failure: quality-gate exhausts retries`) is
      reproduced identically on the base branch via `git stash`, so it's
      pre-existing, not a regression from this track).
- [ ] Manual check: starting a worker from a track's `+ New worker…` flow
      actually presents a provider choice (recorded in quality-gate per
      the real-product-check requirement — screenshot or observed API call).
      Deferred to quality-gate — see plan.md Phase 5's note on why this
      wasn't done during implement (the only reachable dev servers on
      standard ports belong to the main checkout, not this worktree).
- [x] A worker configured with the legacy `cli: 'agy'` value (pre-existing
      data) displays correctly with no manual migration step required —
      `normalizeProviderId` resolves it at every read site (`providerIcon`,
      `providerLabel`, `defaultModelFor`), confirmed by TC-5.
