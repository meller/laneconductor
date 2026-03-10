# Spec: Workflow Logic & Configuration UI

## Problem Statement
Currently, lane transition logic and retries are hardcoded in the sync worker and collector. This makes it difficult for users to customize the development workflow (e.g., changing retry limits or destination lanes) without modifying core code. There is also no way to visualize or edit these rules from the Kanban dashboard.

## Requirements
- **REQ-1**: Expose the workflow configuration (from `conductor/workflow.md`) via a new API on the UI server.
- **REQ-2**: Provide a "Workflow" settings page in the Vite dashboard to view and edit these rules.
- **REQ-3**: The sync worker and collector must respect the `max_retries` and `onSuccess` lane settings from the configuration.
- **REQ-4**: Implement a "ready for action" (blocked) state when maximum retries are exceeded.
- **REQ-5**: Changes made via the UI must persist back to `conductor/workflow.md`.

## Acceptance Criteria
- [ ] UI server has `GET /api/workflow` and `POST /api/workflow` endpoints.
- [ ] Dashboard has a sidebar link to "Workflow".
- [ ] Workflow settings page allows editing JSON/form for lane rules.
- [ ] Sync worker successfully retries failed actions up to `max_retries`.
- [ ] After `max_retries`, track moves to "ready for action" status and stops auto-running.
- [ ] `conductor/workflow.md` is updated correctly when saving from the UI.
