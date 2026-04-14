# Plan: Machine Workers View In All Projects Mode

## Phase 1: Backend API for cross-project workers
**Problem**: No global workers endpoint exists.
**Solution**: Add `GET /api/workers` to the Express server with project information.

- [x] Add `getAllWorkers` query: `SELECT w.*, p.name as project_name FROM workers w LEFT JOIN projects p ON w.project_id = p.id` to `ui/server/index.mjs`.
- [x] Register the `GET /api/workers` route in `ui/server/index.mjs`.
- [x] Test the endpoint manually with `curl http://localhost:8091/api/workers`.

## Phase 2: UI update for "All Projects" mode
**Problem**: UI hides Workers tab when `selectedProjectId` is null.
**Solution**: Modify the sidebar/header to show the tab.

- [x] Find the component responsible for the Lanes/Workers toggle in `ui/src/App.jsx`.
- [x] Remove or update the conditional check that hides it in "All Projects" mode.
- [x] Update `usePolling` hook (`ui/src/hooks/usePolling.js`) to fetch from `/api/workers` when `projectId` is null.

## Phase 3: Update WorkersList component
**Problem**: `WorkersList` might assume it's always within a project context.
**Solution**: Add support for project names and hostname grouping.

- [x] Update `WorkersList` in `ui/src/components/WorkersList.jsx` to display `project_name` for each worker.
- [x] Implement grouping by hostname if not already present.
- [x] Verify the layout looks good with multiple projects across different hostnames.

## ✅ COMPLETE
Implementation of cross-project workers view is finished and verified across backend and frontend.

## ✅ QUALITY PASSED
All requirements met, API endpoints verified, and UI components updated for cross-project visibility.
