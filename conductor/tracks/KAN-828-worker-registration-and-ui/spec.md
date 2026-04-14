# Spec: Worker Registration and UI

## Problem Statement
We want to be able to see which machines are registered as workers and what their current status is. Currently, workers (heartbeat processes) run in the background but provide no visibility into their health or activity in the dashboard. We need a "Workers" view in the UI to show all workers registered to a project, their status (idle/busy), and what they are currently doing.

## Requirements
- **REQ-1: Persistent Worker Registration**: Workers must register themselves in a `workers` table in Postgres upon startup.
- **REQ-2: Real-time Heartbeats**: Workers must update their `last_heartbeat` timestamp every 10 seconds.
- **REQ-3: Status and Task Reporting**: Workers must report their current state:
    - `idle`: Waiting for work or watching files.
    - `busy`: Executing an auto-action (planning, implement, review).
- **REQ-4: Contextual Task Info**: When `busy`, the worker must report which track and action it is executing (e.g., "implement track 014").
- **REQ-5: UI Workers View**: The dashboard must include a way to view all active workers for the selected project.
- **REQ-6: Offline Detection**: The API should filter out workers that haven't sent a heartbeat in over 60 seconds. The UI should display them in a dedicated area if they are active.
- **REQ-7: Multi-Project Awareness**: Workers are registered per project, as defined in their `.laneconductor.json`.
- **REQ-8: WebSocket Push**: The API must broadcast a `worker:updated` event to all connected UI clients whenever a worker registers or updates its status.
- **REQ-9: Queue Visibility**: The Workers view must show all tracks currently in the "waiting" queue across all active projects.
- **REQ-10: Priority Management**: Users must be able to change the priority of tracks in the queue. Higher priority tracks must be picked up by workers first.

## Acceptance Criteria
- [x] `workers` table exists in the database.
- [x] Running `make lc-start` creates or updates a row in the `workers` table with `hostname`, `pid`, and `status = 'idle'`.
- [x] `last_heartbeat` updates automatically while the worker is running.
- [x] When an auto-action (e.g. auto-implement) starts, the worker's status in the DB changes to `busy` with `current_task = 'implement track NNN'`.
- [x] When the task completes, the worker's status returns to `idle`.
- [x] UI displays a list of active workers (heartbeat < 60s ago).
- [x] UI shows status (idle/busy) and task details for each worker.
- [x] Real-time updates: UI reflects status changes without a manual refresh (via WS).
- [x] UI displays a "Waiting Queue" across all projects.
- [x] UI allows increasing/decreasing track priority in the queue.
- [x] Workers pick up higher priority tracks first.

## Data Model

### `workers` Table
| Column | Type | Description |
|---|---|---|
| `id` | SERIAL | Primary Key |
| `project_id` | INTEGER | FK to `projects.id` |
| `hostname` | TEXT | Hostname of the machine running the worker |
| `pid` | INTEGER | Process ID of the worker |
| `status` | TEXT | `idle` or `busy` |
| `current_task` | TEXT | Description of the current activity |
| `last_heartbeat` | TIMESTAMP | Last update time |
| `created_at` | TIMESTAMP | Registration time |

**Unique Constraint**: `(project_id, hostname, pid)`
