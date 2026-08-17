# Track 10014: Project management page

**Status**: review
**Progress**: 100%
**Last Run**: gemini/gemini-3.7-flash-medium (primary)

## Problem
we are missing a project management page in which we can see all project (probably as cards), manage their context - kpi, product, techspec etc (i guess it will be api->db and sync to fs) and able to rename, delete (only from laneconductor or laneconductor + fs - git delete probably out of scope) - maybe more project related actions (we can include smart ai action and pass to the worker to do if you think about something cretive - maybe project status etc)

## Solution
Added a "Projects" tab to the dashboard: a card grid (computed from data
already polled, no new fetch) showing every project's identity, lane
counts, worker status, and a computed health badge, with
Open/Rename/Delete/Manage-Context actions. Rename/Delete are new
`PATCH`/`DELETE /api/projects/:id` routes (delete relies on the cascading
FKs already in `prisma/schema.prisma` and never touches git). "Manage
context" makes the existing read-only `ConductorPanel` editable via a new
`PATCH /api/projects/:id/conductor/:key` endpoint that generalizes the
write-through pattern already used by `workflow.json` (DB `conductor_files`
JSONB + disk write) to `product`, `tech_stack`, `kpis`, and the other
context docs. A "smart AI action" to auto-refresh context from code is
scoped as an explicit deferred Phase 6 — not part of this track's
completion.

## Phases
- [x] Phase 1: Backend — Rename & Delete project
- [x] Phase 2: Backend — Editable conductor context files
- [x] Phase 3: Frontend — Projects page (card grid)
- [x] Phase 4: Frontend — Rename & Delete UI
- [x] Phase 5: Frontend — Editable ConductorPanel
- [ ] Phase 6 (deferred/FFU, not counted toward done): Smart AI project action
**Lane**: review
**Lane Status**: queue
**Summary**: Projects tab (card grid) with rename/delete and editable context files (product/tech-stack/kpis/etc), all backend + frontend implemented and tested (15 new tests, full suite 339/350 pass — 11 pre-existing unrelated failures). Phase 6 (smart AI action) deferred.
