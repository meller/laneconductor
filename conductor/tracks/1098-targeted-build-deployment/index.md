# Track 1098: CI/CD Tab — Centralized Deployment Management

**Lane**: done
**Lane Status**: idle
**Progress**: 100%
**Phase**: Completed
**Type**: dev
**Summary**: Unified the entire deployment lifecycle into the CI/CD tab: tabbed Setup/Config/Release layout, deploy.sh builder wizard (provider→DB→secrets→envs→preview), deployment stack summary card reading…

## Problem

Deployment management was fragmented: dispatch in WorkersList, environment config in ProjectConfigSettings, and no single place to see the current deployment stack or generate a deploy.sh. Operators had to jump between tabs and there was no auditability.

## Solution

- Consolidated CI/CD tab into 3 tabs: **Setup**, **Config**, **Release**.
- **Setup tab**: 5-step wizard (Cloud Provider → Database → Secrets → Environments → Preview/Save) that generates `scripts/deploy.sh` and updates `conductor/deploy.json`.
- **Config tab**: `DeployStackCard` reads `deployment_stack` from `conductor_files` DB (synced by `laneconductor.sync.mjs`), renders it as a structured summary. Below it, `DeployConfigSection` for manual env CRUD.
- **Release tab**: `DeployPanel` (dispatch) + `DispatchHistory` (live-polling audit log).
- Shared `deployConfig` state in `CICDView` flows between wizard and config editor — wizard `onSaved()` populates Config tab and auto-navigates there.
- Smart default tab: **Setup** if no `deployment_stack` exists, **Release** if it does.
- New backend endpoint: `POST /api/projects/:id/deploy-script` — writes `scripts/deploy.sh`, makes it executable (`chmod 755`).
- Removed all deployment UI from `WorkersList.jsx` and `ProjectConfigSettings.jsx`.

## Phases
- [x] Phase 1: Deployment Modal UI → CI/CD tab migration (DeployPanel + DispatchHistory)
- [x] Phase 2: DeployConfigSection migrated from ProjectConfigSettings into CI/CD Config tab
- [x] Phase 3: deploy.sh Builder wizard (5-step, all providers: GCP/AWS/Vercel/Fly/Custom)
- [x] Phase 4: Tabbed CI/CD layout (Setup / Config / Release) with shared state
- [x] Phase 5: DeployStackCard reading deployment_stack from conductor_files DB
- [x] Phase 6: Smart default tab focus based on stack existence
- [x] Phase 7: POST /api/projects/:id/deploy-script backend endpoint

## Files Modified
- `ui/src/components/CICDView.jsx` — full rewrite (tabbed, wizard, stack card)
- `ui/src/components/WorkersList.jsx` — deployment UI removed
- `ui/src/pages/ProjectConfigSettings.jsx` — deploy config section removed
- `ui/src/App.jsx` — CICDView integrated into tab nav
- `ui/server/index.mjs` — new deploy-script endpoint

## Depends on
[1097](../1097-build-artifact-system/index.md)
