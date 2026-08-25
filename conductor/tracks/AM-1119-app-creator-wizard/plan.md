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

- [x] Task 1: Extract shared deployment config helpers (provider list, env defaults, deploy.json shape) into `ui/src/lib/deployConfig.js`, used by the new step; DeployPanel untouched
- [x] Task 2: Credential status endpoint: `GET /api/workers/:id/deploy-credentials?provider=firebase|gcp` — worker-side check (gcloud/firebase auth) reported as verified / NOT CONFIGURED
- [x] Task 3: Wizard payload carries `wizard.deployment`; manager worker's create-project flow writes `conductor/deploy.json`, `deployment-stack.md`, `.env.example` from it

**Impact**: Deployment becomes a first-class wizard step; single source of truth for deploy config shape.

**Verification (2026-08-25)**: `ui/src/lib/deployConfig.js` created (provider list, env defaults,
`buildDeployJson`/`buildDeploymentStackMd`/`buildEnvExample`, matching the exact shape
`GET/POST /api/projects/:id/deploy-config` reads/writes) and mirrored byte-for-byte into
`conductor/deployConfig.mjs` (same pattern as `conductor/providers.mjs` — the sync worker runs
standalone and can't import `ui/src`). `DeploymentStep.jsx` now imports from the shared lib and
adds a non-blocking credential-status badge (`data-testid="deploy-credential-status"`) fetched
from the new `GET /api/workers/:id/deploy-credentials?provider=firebase|gcp` route
(`ui/server/index.mjs`) — runs `gcloud auth list`/`firebase projects:list` synchronously in the
API server process (not the async `worker_dispatch` cycle: local-api mode, this wizard's only
supported mode per spec.md, always runs the Collector API on the same machine as the worker being
configured, so there's no remote-machine problem to solve). `AppCreatorWizard.jsx` now passes
`workerId` into the step. `runCreateProject` (`conductor/laneconductor.sync.mjs`) writes
`conductor/deploy.json` + `deployment-stack.md` + `.env.example` from `entry.payload.wizard.deployment`
— placed *after* the `setup scaffold generate` AI call, not before, since that skill command
unconditionally stubs `deployment-stack.md` and would otherwise clobber the wizard-derived
content. Found and fixed a real bug surfaced by the first test run: writing `.env.example` at the
target repo root before the git-init step made the git-init step's "only auto-init on an
untouched scaffold" guard see it as unexpected pre-existing content and abort the *entire*
`create-project` dispatch (reported `status: 'failed'` even though `deploy.json` itself had
already been written) — fixed by adding `.env.example` to `SCAFFOLD_ENTRIES` (safe: it's a
variable-name template with no real values, unlike `.env` itself, which stays excluded).

New/updated tests, all passing: `ui/src/lib/deployConfig.test.js` (11 tests, TC-4's shape
equality), `ui/server/tests/track-1119-deploy-credentials.test.mjs` (6 tests, TC-5, mocks
`spawnSync`), `ui/src/components/NewProjectModal.test.jsx` (+1 test: selects Firebase + `prod`,
asserts the exact `wizard.deployment` payload and the credential badge renders without blocking
Next/Launch), `conductor/tests/track-1119-wizard-dispatch.test.mjs` (new — 2 tests, spawns a real
manager worker against a mock collector: firebase+2-envs writes all three artifacts with the
right shape *and* the dispatch resolves `done` not `failed` — a regression guard for the bug
above — and `provider: 'skip'` writes no `deploy.json`). Ran the full `ui` vitest suite: 496
tests, same 30 pre-existing failures as Phase 1's baseline (auth/Firebase-env, track-1116
model-override, WorkflowSettings — none touch this track's files), zero new failures. Ran the
targeted conductor suite (`track-1091-create-project-worker`, `create-project-utils`,
`track-1119-wizard-dispatch`): 11/11 pass. TC-6 (DeployPanel/CICDView unchanged) verified by
construction — `CICDView.jsx`/`DeployLogView.jsx` were not touched this phase.

## Phase 3: Track auto-generation with Auto Run

**Problem**: After scaffold, the board is empty; the user must invent tracks manually.
**Solution**: Manager worker extends create-project to generate an initial track breakdown from wizard input via the file_sync_queue protocol, each track `**Auto Run**: yes`.

- [x] Task 1: Prompt/template in the worker's create-project handler: derive 3–6 tracks (scaffold/app skeleton → feature tracks from product description → final "Deploy to <provider>" track) with proper `INITIALS-NNN-slug` naming
- [x] Task 2: Write track folders + `file_sync_queue.md` entries with `**Auto Run**: yes`, `**Author**`, `**Created By**`, and dependency ordering (deploy track last, gated on prior tracks reaching done)
- [x] Task 3: Dispatch result includes the generated track list so the wizard can display it immediately

**Impact**: Launch → populated board, no manual track creation.

**Verification (2026-08-25)**: Deliberately **not** an LLM step — `conductor/services/wizard-track-plan.mjs`'s
`deriveTrackPlan()` is a pure, deterministic function turning the wizard's own structured answers
(`scaffold_context.brainstorm_summary`'s "Project purpose"/"Target users"/"Tech stack"/"Success
metrics" lines, already built by `AppCreatorWizard.jsx`'s `buildWizardPayload`) into an ordered
track list: always an "App Skeleton" track, a "Core Feature" track grounded in the purpose line
(present whenever Launch is reachable, since `ProductStep.jsx` requires it), a "Success Metrics"
track only when KPIs were filled in, and — when a real provider was chosen — a final
"Deploy to `<provider>`" track with `dependsOnAll: true`. Never fabricates feature ideas beyond
what the user actually typed. `writeGeneratedTracks()` (`conductor/laneconductor.sync.mjs`, called
from `runCreateProject` right after the deploy-artifacts block) turns that plan into real files:
mirrors `lc new`'s exact `index.md`/`file_sync_queue.md` format (`bin/lc.mjs`'s `command === 'new'`
branch), reusing `conductor/services/author.mjs`'s `getAuthorInfo()` (extended with an optional
`cwd` param, backward-compatible) so generated tracks carry the SAME git-derived
`**Author**`/`**Created By**` a human-created track would get — running `git config` inside the
new project's own repo, not this manager's. Every generated track additionally carries
`**Auto Run**: yes`; the deploy track alone carries `**Depends On**: <every prior generated track
number>`.

**Dependency ordering (Task 2's "gated on prior tracks reaching done")**: added a genuinely new
worker capability, not just a marker — `parseDependsOn()` + a gate in `autoLaunchLocalFs`'s
claim loop (`conductor/laneconductor.sync.mjs`) that skips auto-launching any track naming
unmet dependencies (a dependency on a nonexistent track number fails closed — treated as unmet,
never satisfied). Bypassed only for `waitingForReply`, matching the existing `autoRun`/
`claimableSet` gates' own bypass reasoning. This is shared machinery — `autoLaunchLocalFs` is the
one auto-launch loop used by both local-fs and local-api/remote-api modes (confirmed by reading
both call sites), so the gate protects every mode, not just the wizard's.

Dispatch `result` (Task 3) now appends `\nGenerated tracks: <displayId, displayId, …>` after the
existing `Created at <path>` line — kept that exact prefix since `track-1091-create-project-worker.test.mjs`
already asserts on it; Phase 5's "follow your build" view will read the real track rows once it
exists, this is the interim visibility Task 3 asked for.

New tests, all passing: `conductor/tests/wizard-track-plan.test.mjs` (6 tests — pure derivation:
always starts with App Skeleton, purpose/KPI-conditional tracks, exactly one deploy track with
`dependsOnAll`, 3–6 track count for a fully-filled wizard input), `conductor/tests/track-1119-phase3-depends-on.test.mjs`
(3 tests, spawns a real worker process — TC-9's ordering half: a track with an unmet dependency is
never launched, the same track launches once its dependency reaches `done`, a dependency on a
nonexistent track fails closed), `conductor/tests/track-1119-phase3-track-generation.test.mjs`
(1 test, real manager worker + mock collector — TC-7/TC-8/TC-9's DB-registration half: 3–6 folders
with the right markers, exactly one deploy track naming the provider and declaring dependencies,
matching `file_sync_queue.md` entries, and the freshly-spawned project worker registers every one
in the DB on its own next cycle).

**Found and fixed a real environment issue while writing the Depends On test** (not a Phase 3 code
bug, but worth recording): `laneconductor.sync.mjs` has a safety net (track 1102 REQ-1) that
redirects a worker launched from a non-git scratch directory to the nearest enclosing "primary"
git checkout — correct in production, but my test's tmp sandbox (never `git init`'d, since it
tests the auto-launch loop directly rather than going through `runCreateProject`) sat inside this
very worktree, so the redirect pointed it at `/home/meller/Code/laneconductor`'s real, live
collector/DB for one run before I set the documented `LC_SKIP_CWD_NORMALIZATION=1` test-only
escape hatch (already used elsewhere for exactly this "dogfooded worktree" scenario). Confirmed
this is pre-existing and not something Phase 3 introduced: the untouched `local-fs-e2e.test.mjs`
exhibits the identical symptom in this environment (same missing env var), and passes cleanly once
run with it set — not fixed here since that file is out of this track's scope.
`track-1119-phase3-track-generation.test.mjs` never needed the same fix: `runCreateProject` always
`git init`s the target directory into its own standalone repo before spawning its worker, so it
never qualifies for the "not primary checkout" redirect.

Ran the targeted conductor suite together (author-normalization, create-project, wizard-plan,
depends-on, track-generation): 26/26 pass. Ran the full pre-existing `local-fs-e2e.test.mjs` suite
(7 tests, unmodified) with the same env fix: 7/7 pass — confirms the new `laneStatusByTrackNumber`
map and dependency gate didn't regress the existing Auto Run gate or pipeline tests. Ran the full
`conductor/tests/*.test.mjs` suite (128 files) twice, comparing against Phase 2's already-established
baseline: 47/473 failing (down from Phase 2's 55/473, since the env fix also quietly helps several
pre-existing suites) — my own new Depends On test intermittently shows in that failing set under
full-suite resource contention (128 real-process-spawning integration tests running concurrently)
but passed reliably 4/4 times run in isolation or in small groups; several unrelated,
untouched suites (worker identity, dispatch inbox, session resume, lock/unlock) show the same
contention-driven flakiness in that run, consistent with this track's own conversation.md history
of "heavy concurrent automated churn" on this dev machine. No new *reproducible* failures
attributable to Phase 3's code changes.

## Phase 4: Deploy-to-URL + app_url plumbing

**Problem**: Nothing records where the finished app lives.
**Solution**: `projects.app_url` column + API; the generated deploy track runs `lc deploy`, parses the hosting URL (Firebase CLI output / configured URL), and PATCHes it back.

- [x] Task 1: Migration `projects.app_url TEXT`; `GET /api/projects/:id` returns it; `PATCH` (or `POST /api/projects/:id/app-url`) sets it
- [x] Task 2: Deploy-track template instructs capturing the deployed URL and calling the collector API on success
- [x] Task 3: ProjectCard + project header show a "Live ↗" link when `app_url` is set

**Impact**: The system knows, and shows, the deployed app's address.

**Verification (2026-08-25)**: `ui/server/migrations/011_app_url.sql` adds `projects.app_url TEXT`
(applies idempotently on server startup, same self-applying mechanism as `006`-`010` — confirmed
canonical for this repo's day-to-day column additions today; the root `migrations/`+Atlas ledger
and this mechanism's undocumented split responsibility is a real, already-tracked open decision
— track 10033 — out of this track's scope to resolve). `POST /api/projects/:id/app-url`
(`ui/server/index.mjs`) is a dedicated endpoint, not folded into the existing rename `PATCH
/api/projects/:id`: that route requires `name`, a human-edit contract, whereas `app_url` is set by
a track's own unattended run — different caller, different validation (400 on a non-http(s),
non-null value; `null` explicitly clears it). `GET /api/projects` (the list endpoint — spec.md's
original `GET /api/projects/:id` doesn't exist anywhere in this codebase; amended spec.md to say
so) now selects `app_url` in both its authenticated-remote and local-mode query branches.

Task 2 is documentation/instruction, not a new automated network call: `deriveTrackPlan`'s deploy
track Solution text (`wizard-track-plan.mjs`) now names the concrete endpoint, payload shape, and
where to find the URL to report — deliberately NOT wiring `lc deploy` itself to auto-POST the
result, since that would require duplicating this repo's collector-auth/token-resolution logic
(today only inside `laneconductor.sync.mjs`) into `bin/lc.mjs`, unverifiable without real
Firebase/GCP credentials this environment doesn't have (see spec.md's Out of Scope). What IS real,
testable code: `conductor/deploy-runner.mjs`'s `runDeploy` now resolves and returns a `url` on
success — `envConfig.expected_url` when present (Firebase Hosting's default domain is a
deterministic function of the project id `deployCommandFor` already assumes, computed at
deploy-config-generation time by `deployConfig.js`'s `buildDeployJson` and stored per-environment),
otherwise parsed from real captured command output (`Service URL: <url>` for `gcloud run deploy`,
or a generic `https://…(web.app|firebaseapp.com|run.app|vercel.app)` match) — `null`, never a
guess, when neither is found. `lc deploy`'s CLI output now prints `🔗 Live URL: <url>` when
resolved, so a human or an implement-phase AI agent driving it sees the exact value to report.

New/extended tests, all passing: `ui/server/tests/track-1119-app-url.test.mjs` (5 tests — 404/400
validation, TC-10's round-trip, `null` clears, `GET /api/projects` includes `app_url`),
`ui/src/components/ProjectCard.test.jsx` (+2 tests — TC-11: no link before, correct `href`/`target`
after), `ui/src/lib/deployConfig.test.js` (+2 tests — `expected_url` set for firebase matching the
deploy command's own project-id assumption, absent for gcp), `conductor/tests/deploy-runner.test.mjs`
(+6 tests — `runDeploy`'s `url` field via `expected_url` / output-parsed / `null`, plus
`resolveDeployedUrl` directly), `conductor/tests/wizard-track-plan.test.mjs` (+1 test — deploy
track Solution names the endpoint/payload). Ran the full `ui` vitest suite: 516 tests, same 30
pre-existing failures as Phases 1-3's baseline, zero new failures. Ran the targeted conductor
group (create-project-utils, track-1091, wizard-track-plan, deploy-runner, both Phase 3
integration tests, wizard-dispatch): 35/35 pass.

AC-4/AC-5 (a *real* deploy with a reachable URL, and the progress view showing it) remain
explicitly deferred to Phases 5-6 — this phase built the plumbing and the honest, tested URL
resolution logic; it did not attempt a real Firebase/GCP deploy (no credentials in this
environment, and REQ-4's autonomous deploy track hasn't run yet — Phase 3 only generates it).

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
