# Track 005: DB as Transport for Conductor File Content

**Lane**: done
**Lane Status**: success
**Progress**: 100%

## Problem
The UI can only show track status/progress from the DB. It has no way to display the full content of conductor context files (product.md, tech-stack.md, workflow.md) or per-track files (index.md, plan.md, spec.md) — because the UI/API doesn't read from the filesystem.

## Solution
Use the DB as the transport layer for all conductor file content. The heartbeat worker already pushes status fields — extend it to push full markdown content for context files and per-track files. The UI then reads everything from the DB, with no filesystem dependency.

## Phases
- [x] Phase 1: DB schema — add content storage to projects + tracks tables
- [x] Phase 2: Heartbeat worker — push full file content on change
- [x] Phase 3: Express API — new endpoints for conductor files + track detail
- [x] Phase 4: UI — project context panel + per-track detail view
