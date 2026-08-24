# Track 1092: CI/CD Tab — Deploy Config, Dispatch History & deploy.sh Builder

**Lane**: quality-gate
**Lane Status**: queue
**Progress**: 100%
**Last Run**: claude/claude-sonnet-5 (primary)
**Phase**: Implementation
**Type**: dev
**Summary**: A dedicated CI/CD tab (alongside Lanes and Workers) that consolidates deployment config, dispatch history, and an interactive deploy.sh builder — so the entire deploy lifecycle lives in one place.

## Problem

Deployment concerns are currently scattered:
- The **Deploy Now** button and **Dispatch History** live in the Workers tab, mixed in with worker management UI.
- The deploy configuration (`conductor/deploy.json`) can only be created via `lc setup-deploy` (CLI wizard) or by hand-editing JSON — no web UI exists.
- The **deploy.sh builder** from `lc setup-deploy` (cloud provider selection, DB credentials, env vars) has no web equivalent, leaving web-only users stranded.
- There is no single place in the UI that shows the full deployment lifecycle: config → trigger → history.

## Solution

Add a **CI/CD tab** to the main navigation (alongside Lanes and Workers) that unifies three things:

### Section 1: Deploy Config Editor
- Full read/write of `conductor/deploy.json` via `GET`/`POST /api/projects/:id/deploy-config`
- List configured environments with their commands
- Add / edit / remove environments inline
- Shows `defaultEnvironment` and allows setting it
- Empty-state card that prompts to use the Builder (Section 3)

### Section 2: Dispatch History
- Moved from the bottom of the Workers tab into this dedicated tab
- Enriched view with env badge, build vs HEAD badge, worker identity badge
- Deploy log panel (`DeployLogView`) accessible inline

### Section 3: deploy.sh Builder (UX Wizard)
Web equivalent of `lc setup-deploy`. A step-through form that generates a `deploy.sh` scaffold and saves it to `conductor/deploy.json`:

- **Step 1 — Cloud Target**: Select provider (GCP Cloud Run, AWS ECS, Fly.io, Railway, Custom SSH, Local)
- **Step 2 — Environment Variables**: Add key/value pairs injected into the deploy script
- **Step 3 — Database**: DB connection method (Cloud SQL, RDS, connection string, none)
- **Step 4 — Build Integration**: link to a build artifact or HEAD; inject `CONDUCTOR_BUILD_ID`
- **Step 5 — Review & Save**: Preview the generated `deploy.sh` shell command, name the environment, set as default, save to `deploy.json`

The builder always produces a `deploy.json`-compatible command string — same schema already used by Track 1085's "Deploy Now" control.

## Phases

- [x] Phase 0: Tab scaffolding — add `cicd` to the 3-way tab switcher (`lanes` | `workers` | `cicd`) in `App.jsx`; stub `CICDView.jsx`
- [ ] Phase 1: Dispatch History — move the history panel out of `WorkersList.jsx` into `CICDView.jsx` (keep a compact summary strip in Workers tab for context)
- [ ] Phase 2: Deploy Config Editor — `GET`/`POST /api/projects/:id/deploy-config` API + editor UI section
- [ ] Phase 3: deploy.sh Builder — step wizard UI; generates shell command + writes `deploy.json` environment entry
- [ ] Phase 4: Default Environment & Smart Presets — `defaultEnvironment` field; convention presets (GCP, Railway…)
- [ ] Phase 5: Tests — API read/write round-trip; builder → save → dispatch flow; empty/missing deploy.json (first save creates it)

## Depends on
[1085](../1085-manual-worker-dispatch/index.md) — Deploy Now control whose config this edits
[1098](../1098-targeted-build-deployment/index.md) — Build artifact selector integrated into Section 3 Step 4
