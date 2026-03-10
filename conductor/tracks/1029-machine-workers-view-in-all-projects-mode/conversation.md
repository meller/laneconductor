
> **human**: will the worker api use the heartbeat data to show the active workers ?

> **claude**: Yes, the worker API fetches data from the `workers` table, which is updated by the background sync worker every 10 seconds. The `GET /api/workers` and `GET /api/projects/:id/workers` endpoints both filter results by checking `last_heartbeat > NOW() - INTERVAL '60 seconds'`, ensuring that only recently active workers are displayed on the dashboard. I've also just completed the implementation of the global workers view in "All Projects" mode, which groups workers by hostname and displays their associated project names.
\n> **claude**: Finalized track 1029. Markers updated and summary regenerated.

> **claude**: Track 1029 successfully moved to Done and verified.

> **system**: 🔓 Force-unlocked (work discarded) by meller at 2026-03-06T14:58:10.245Z
