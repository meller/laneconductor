# Spec: Machine Workers View In All Projects Mode

## Problem Statement
In "All Projects" mode, the system currently hides the Workers view or scopes it to a specific project. This makes it impossible to see the global state of all workers on the machine across different projects from the "All Projects" dashboard.

## Requirements
- **REQ-1**: Add a new API endpoint `GET /api/workers` that returns all active workers across all projects.
- **REQ-2**: Join workers with project names in the API response using `LEFT JOIN projects`.
- **REQ-3**: Show the "Workers" tab even when "All Projects" is selected (`selectedProjectId` is null).
- **REQ-4**: Update `usePolling` to fetch the global workers list when no project is selected.
- **REQ-5**: Update `WorkersList` to handle the cross-project view, displaying project names and grouping workers by hostname.

## Acceptance Criteria
- [x] `GET /api/workers` returns workers from all projects with their project names.
- [x] The "Workers" toggle is visible in the "All Projects" dashboard.
- [x] Selecting "Workers" in "All Projects" mode shows workers grouped by machine.
- [x] Workers in the list clearly identify which project they belong to.
