# Plan: Quality Gate Lane and Project Setting

## Phase 1: Backend & Schema Updates ✅ COMPLETE
**Problem**: The database and API do not recognize the `quality-gate` status or the new project setting.
**Solution**: Update the database schema and the Express server validation.

- [x] Task 1.1: Add `create_quality_gate` column to `projects` table
- [x] Task 1.2: Update `VALID_LANES` in `ui/server/index.mjs`
- [x] Task 1.3: Update project GET/POST/PATCH endpoints
- [x] Task 1.4: Update project lookup to return setting

## Phase 2: UI Updates ✅ COMPLETE
**Problem**: The Kanban board and Track cards need to display and handle the new lane.
**Solution**: Update React components to support the `quality-gate` lane.

- [x] Update `LANES` in `ui/src/components/KanbanBoard.jsx`.
- [x] Update `LANE_STYLES` in `ui/src/components/TrackCard.jsx` (e.g., purple or teal color).
- [x] Update `NEXT_LANE` and `NEXT_LANE_LABEL` in `TrackCard.jsx`.
- [x] Add conditional logic to `NEXT_LANE` in `TrackCard.jsx` to check if `quality-gate` is enabled for the project.

## Phase 3: Skill & CLI Updates ✅ COMPLETE
**Problem**: The `/laneconductor` commands are not aware of the new lane or setting.
**Solution**: Update the `SKILL.md` instructions and implementation logic.

- [x] Update `SKILL.md` Core Mandates and command descriptions.
- [x] Update `/laneconductor setup collection` to prompt for "Enable Quality Gate lane? (y/n)".
- [x] Update `/laneconductor setup scaffold` to include `conductor/quality-gate.md` in the generated files if enabled.
- [x] Update `/laneconductor review` verdict logic to transition to `quality-gate` instead of `done` when applicable.

## Phase 4: Sync Worker & Template Updates ✅ COMPLETE
**Problem**: The heartbeat worker doesn't recognize the new status markers.
**Solution**: Update the parser in `laneconductor.sync.mjs`.

- [x] Update `parseStatus` in `conductor/laneconductor.sync.mjs`:
    - `✅ QUALITY PASSED` -> `done`
    - `✅ REVIEWED` -> check project setting, then `quality-gate` or `done`
- [x] Create the default `quality-gate.md` template content.
- [x] Update `SKILL.md` with the new marker definitions.

## Phase 5: Verification ✅ COMPLETE

- [x] Verify `quality-gate` lane appears in UI
- [x] Verify `✅ QUALITY PASSED` moves track to Done
- [x] Verify `✅ REVIEWED` moves track to Quality Gate (since enabled)

## ✅ REVIEWED

## ✅ QUALITY PASSED
