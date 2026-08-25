# Track AM-1119: App Creator Wizard Mode (E2E New-Project Wizard)

## Phase 1: Wizard shell + step components

**Problem**: Project creation is one flat form; no room for design/deployment input or guided flow.
**Solution**: A stepper wizard (`AppCreatorWizard.jsx`) with five steps as reusable components, sharing one wizard-state object; "Quick create" toggle keeps the existing single-form path.

- [x] Task 1: Extract current NewProjectModal form into `steps/BasicsStep.jsx` (name, repo source, manager worker) without behavior change
- [x] Task 2: Add `steps/ProductStep.jsx` (description, target users, KPIs), `steps/DesignStackStep.jsx` (visual style prompt, stack preset select + free text)
- [x] Task 3: Wizard container with step indicator, per-step validation, Back/Next preserving state, Escape/close guards matching current modal behavior
- [x] Task 4: "Quick create" toggle → renders the legacy single form (existing tests keep passing)

**Impact**: New wizard UX; old path intact.

**Verification (2026-08-25)**: `ui/src/components/wizard/{AppCreatorWizard,BasicsStep,ProductStep,DesignStackStep,DeploymentStep,ReviewLaunchStep}.jsx`
created; `NewProjectModal.jsx` gained a Quick create/Guided wizard toggle, sharing one
`dispatchCreateProject` helper. New `NewProjectModal.test.jsx` (3 tests): quick-create still
sends `scaffold_context`-only payload (no `wizard` key), wizard walks all 5 steps and dispatches
`scaffold_context` + `wizard` + `repo_source`, Back preserves entered values across steps. Ran the
full `ui` vitest suite before and after: 30 pre-existing failures (server auth/API tests requiring
Firebase env, WorkflowSettings tests unrelated to this track) present identically on `main` —
zero new failures, 3 new passing tests. DeploymentStep in this phase collects intent only (no
real credential check yet — that's Phase 2 REQ-2/TC-5).

## Phase 2: Deployment step (reuse deploy UX/domain)

**Problem**: Deployment config lives only in the CLI `lc setup-deploy`; the UI has DeployPanel for *running* deploys but nothing for *configuring* them.
**Solution**: `steps/DeploymentStep.jsx` — provider choice (Firebase Hosting / GCP Cloud Run / skip), environments, credential status check; output feeds the scaffold dispatch so the worker writes `deploy.json` + `deployment-stack.md` exactly as `setup-deploy generate` does.

- [ ] Task 1: Extract shared deployment config helpers (provider list, env defaults, deploy.json shape) into `ui/src/lib/deployConfig.js`, used by the new step; DeployPanel untouched
- [ ] Task 2: Credential status endpoint: `GET /api/workers/:id/deploy-credentials?provider=firebase|gcp` — worker-side check (gcloud/firebase auth) reported as verified / NOT CONFIGURED
- [ ] Task 3: Wizard payload carries `wizard.deployment`; manager worker's create-project flow writes `conductor/deploy.json`, `deployment-stack.md`, `.env.example` from it

**Impact**: Deployment becomes a first-class wizard step; single source of truth for deploy config shape.

## Phase 3: Track auto-generation with Auto Run

**Problem**: After scaffold, the board is empty; the user must invent tracks manually.
**Solution**: Manager worker extends create-project to generate an initial track breakdown from wizard input via the file_sync_queue protocol, each track `**Auto Run**: yes`.

- [ ] Task 1: Prompt/template in the worker's create-project handler: derive 3–6 tracks (scaffold/app skeleton → feature tracks from product description → final "Deploy to <provider>" track) with proper `INITIALS-NNN-slug` naming
- [ ] Task 2: Write track folders + `file_sync_queue.md` entries with `**Auto Run**: yes`, `**Author**`, `**Created By**`, and dependency ordering (deploy track last, gated on prior tracks reaching done)
- [ ] Task 3: Dispatch result includes the generated track list so the wizard can display it immediately

**Impact**: Launch → populated board, no manual track creation.

## Phase 4: Deploy-to-URL + app_url plumbing

**Problem**: Nothing records where the finished app lives.
**Solution**: `projects.app_url` column + API; the generated deploy track runs `lc deploy`, parses the hosting URL (Firebase CLI output / configured URL), and PATCHes it back.

- [ ] Task 1: Migration `projects.app_url TEXT`; `GET /api/projects/:id` returns it; `PATCH` (or `POST /api/projects/:id/app-url`) sets it
- [ ] Task 2: Deploy-track template instructs capturing the deployed URL and calling the collector API on success
- [ ] Task 3: ProjectCard + project header show a "Live ↗" link when `app_url` is set

**Impact**: The system knows, and shows, the deployed app's address.

## Phase 5: "Follow your build" progress view

**Problem**: A newcomer who launches the wizard has no idea what the lanes mean, whether things are progressing, or where the app link will appear.
**Solution**: Post-launch handoff view (`FollowBuildView.jsx`) reachable from the wizard's final screen and the project page.

- [ ] Task 1: Plain-language workflow explainer (plan → implement → review → quality-gate → done) with the generated tracks listed against their current lane, polling live
- [ ] Task 2: Prominent app-URL slot: "Your app will appear here when the Deploy track finishes" → live link on completion
- [ ] Task 3: Failure surfacing: tracks whose latest system comment is ⚠️/❌ (Inbox classification) render as "Needs your input" with a link to the track detail panel

**Impact**: The e2e promise is legible to a non-expert user.

## Phase 6: E2E validation — the digger game scenario

**Problem**: Only a real run proves the chain (wizard → scaffold → auto tracks → auto run → deploy → link).
**Solution**: Scripted end-to-end validation on local-api.

- [ ] Task 1: Playwright spec driving the wizard UI through all five steps (mock worker or test manager) asserting dispatch payload shape and post-launch view render
- [ ] Task 2: Integration test (mock collector pattern from `conductor/tests/`) for create-project → track generation → queue entries with Auto Run markers
- [ ] Task 3: One real manual run: "digger game" description, real Firebase creds, observe tracks run to done and fetch the live URL; record observations in conversation.md

**Impact**: AC-1..AC-7 verified against the real product, not just units.
