# Tests: Track AM-1119 — App Creator Wizard Mode

## Test Commands

```bash
# UI unit/component tests (vitest)
cd ui && npx vitest run src/components/AppCreatorWizard.test.jsx src/components/NewProjectModal.test.jsx src/components/CICDView.test.jsx 2>/dev/null || npx vitest run

# Conductor integration tests (node, mock collector pattern)
node --test conductor/tests/track-1119-wizard-dispatch.test.mjs

# Playwright e2e
cd ui && npx playwright test e2e/app-creator-wizard.spec.js
```

## Test Cases

### Phase 1: Wizard shell
- [x] TC-1: Wizard renders five steps; Next is disabled until the current step's required fields validate — expected: cannot advance past Basics without name+repo+worker
- [x] TC-2: Back from step 3 to step 2 preserves previously entered product description and KPIs — expected: values intact
- [x] TC-3: "Quick create" toggle renders the legacy single form and submits the same `scaffold_context` payload as before — expected: existing NewProjectModal tests pass unchanged

### Phase 2: Deployment step
- [x] TC-4: Selecting Firebase Hosting + one environment produces a `wizard.deployment` payload matching the `deploy.json` schema (environments, components, secrets strategy) — expected: shape equality
- [x] TC-5: Credential check endpoint returns `verified` when the worker machine has firebase auth, `NOT CONFIGURED` otherwise; step renders the status badge — expected: both states render, neither blocks Launch (warning only)
- [x] TC-6: DeployPanel (CICDView) renders and deploys as before after helper extraction — expected: existing CICDView behavior/tests unchanged

### Phase 3: Track auto-generation
- [x] TC-7: create-project dispatch with wizard payload writes 3–6 track folders + queue entries; every generated index.md contains `**Auto Run**: yes`, `**Author**`, `**Created By**` — expected: grep confirms markers
- [x] TC-8: Generated set always ends with exactly one deploy track referencing the chosen provider — expected: last track slug/title contains deploy + provider
- [x] TC-9: Sync worker registers generated tracks in DB on next heartbeat and (in sync+poll mode) claims the first queued track — expected: DB rows exist, first track leaves `queue`
      *(DB-registration half verified against a real spawned project worker; "claims the first
      queued track in sync+poll mode" half verified separately via the **Depends On** gate test —
      see plan.md's Phase 3 verification note for why these are two different tests.)*

### Phase 4: app_url
- [ ] TC-10: `PATCH`/app-url endpoint sets `projects.app_url`; `GET /api/projects/:id` returns it — expected: round-trip
- [ ] TC-11: ProjectCard shows "Live ↗" link only when app_url set — expected: absent before, present after

### Phase 5: Follow-build view
- [ ] TC-12: View lists generated tracks with live lane badges, polling updates within 2s of a DB lane change — expected: lane badge updates without reload
- [ ] TC-13: Track whose latest system comment starts with ⚠️/❌ renders in "Needs your input" — expected: classification matches Inbox rules
- [ ] TC-14: When deploy track completes and app_url is set, the live link replaces the placeholder — expected: anchor with app_url href

### Phase 6: E2E
- [ ] TC-15: Playwright: full wizard walk-through → Launch → follow-build view visible with generated track list — expected: spec passes
- [ ] TC-16: Manual digger-game run with real Firebase creds: all generated tracks reach done, `curl $app_url` returns HTTP 200 — expected: recorded observation in conversation.md

## Acceptance Criteria
- [x] All unit + integration tests above pass *(Phase 1's TC-1..TC-3 — 3/3; Phase 2's TC-4..TC-6;
      Phase 3's TC-7..TC-9 — see plan.md verification notes)*
- [x] Existing suites (NewProjectModal, CICDView, worker tests) show no regressions *(full ui vitest suite: same 30 pre-existing failures as main, no new failures)*
- [ ] AC-4/AC-5 verified by a real deploy with a reachable URL (evidence recorded)
