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
- [ ] TC-1: `normalizeProviderId('agy')` returns `'antigravity'`.
- [ ] TC-2: `normalizeProviderId('claude')` returns `'claude'` (already canonical, no-op).
- [ ] TC-3: `normalizeProviderId('some-future-provider')` returns the input
      unchanged (unrecognized ids pass through rather than throwing).
- [ ] TC-4: `PROVIDER_IDS` equals `['claude', 'gemini', 'copilot', 'antigravity']`
      (order used to drive UI dropdown rendering).
- [ ] TC-5: `providerIcon('antigravity')` and `providerIcon('agy')` return
      the same icon (alias resolves before lookup).
- [ ] TC-6: `providerIcon('unknown-id')` returns the generic fallback (🤖),
      not undefined/throw.
- [ ] TC-7: `defaultModelFor('gemini')` returns the first entry of
      `PROVIDERS.gemini.models`, not any other provider's model id.
- [ ] TC-8: `defaultModelFor('unknown-id')` returns `null`.
- [ ] TC-9 *(only if mirrored `ui/src/lib/providers.js` was needed)*:
      `conductor/providers.mjs` and `ui/src/lib/providers.js` export
      deep-equal `PROVIDERS` and `PROVIDER_IDS`.

### Phase 2: Node-side consumers
- [ ] TC-10: Running `lc setup`'s agent-selection step and choosing
      Antigravity writes `"cli": "antigravity"` into `.laneconductor.json`
      — not `"agy"`.
- [ ] TC-11: `conductor/laneconductor.sync.mjs`'s `discoverAvailableModels('agy')`
      (legacy config) resolves and discovers Antigravity's models, same as
      calling it with `'antigravity'`.
- [ ] TC-12: Gemini model discovery (mocked exec) no longer invokes
      `agy models` as its primary path; on live-discovery failure it falls
      back to `PROVIDERS.gemini.models`, not Antigravity's list.
- [ ] TC-13: `PATCH /api/workers/:id/config` with `{ cli: 'agy' }` succeeds
      and the stored row reads `cli: 'antigravity'` (normalized on write).
- [ ] TC-14: `POST /worker/register` (or the heartbeat PATCH path) with a
      legacy `'agy'` cli value stores `'antigravity'` in the `workers` table.
- [ ] TC-15: `POST /track/:num/comment` with `author: 'antigravity'` is
      accepted and persisted as `'antigravity'` (previously downgraded to
      `'human'`).
- [ ] TC-16: `POST /track/:num/comment` with `author: 'copilot'` is
      accepted and persisted as `'copilot'`.

### Phase 3: UI display fixes
- [ ] TC-17: `WorkersList.jsx` grid layout, worker `{ cli: 'gemini', model: null }`
      — rendered model badge text does not equal `'claude-3-5-sonnet'` and
      does not contain the word "claude".
- [ ] TC-18: `WorkersList.jsx` strip layout — same assertion as TC-17.
- [ ] TC-19: `WorkersList.jsx`, worker `{ cli: 'copilot', model: null }` —
      renders the Copilot icon, not the generic 🤖 fallback.
- [ ] TC-20: `TrackCard.jsx`'s `AgentBadge` for `track.primary_cli === 'antigravity'`
      renders the Antigravity label/icon, not the generic "AI" fallback.
- [ ] TC-21: `TrackDetailPanel.jsx`'s `CommentBubble` for
      `comment.author === 'copilot'` renders with a Copilot-specific style,
      not falling through to the default/human style.
- [ ] TC-22: `ProjectConfigSettings.jsx` primary CLI `<select>` contains
      options with values `claude`, `gemini`, `copilot`, `antigravity`.
- [ ] TC-23: `ProjectConfigSettings.jsx` secondary CLI `<select>` — same as TC-22.

### Phase 4: Provider choice when starting a new worker
- [ ] TC-24: `TrackDetailPanel.jsx`, project has at least one available
      manager worker — selecting `+ New worker…` opens `ProvisionWorkerModal`
      (not an immediate silent POST to `start-new`).
- [ ] TC-25: `TrackDetailPanel.jsx`, project has no manager worker —
      selecting `+ New worker…` shows an inline provider/model picker
      before any worker is started.
- [ ] TC-26: `POST /api/projects/:id/workers/start-new` with body
      `{ cli: 'gemini', model: 'gemini-2.5-pro' }` invokes
      `lc start --worker-number N --cli gemini --model gemini-2.5-pro`.
- [ ] TC-27: `POST /api/projects/:id/workers/start-new` with no body
      (existing callers) still invokes plain `lc start --worker-number N`
      — no regression for callers that don't pass a provider.
- [ ] TC-28: `lc start --cli gemini --model gemini-2.5-pro` registers the
      worker with `cli: 'gemini', model: 'gemini-2.5-pro'` regardless of
      `.laneconductor.json`'s `project.primary.cli`.
- [ ] TC-29: `lc start` with no `--cli` flag (existing behavior) still uses
      `project.primary.cli` from `.laneconductor.json` — no regression.

## Acceptance Criteria
- [ ] All unit tests pass (`node --test`, `cd ui && npm test`).
- [ ] No regressions in existing worker E2E suites
      (`local-fs-e2e.test.mjs`, `local-api-e2e.test.mjs`).
- [ ] Manual check: starting a worker from a track's `+ New worker…` flow
      actually presents a provider choice (recorded in quality-gate per
      the real-product-check requirement — screenshot or observed API call).
- [ ] A worker configured with the legacy `cli: 'agy'` value (pre-existing
      data) displays correctly with no manual migration step required.
