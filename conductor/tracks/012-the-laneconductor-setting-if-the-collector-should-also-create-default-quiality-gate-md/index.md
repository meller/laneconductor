# Track 012: the laneconductor setting if the collector should also create default quiality gate.md

**Lane**: done
**Lane Status**: success
**Progress**: 100%

## Problem
Currently, the workflow moves directly from Review to Done. Users want an intermediate "Quality Gate" lane to verify standards like test coverage and linting. Additionally, there should be a setting to automatically create a default `quality-gate.md` during project setup.

## Solution
1. Add a `quality-gate` lane to the Kanban board and backend.
2. Add a `create_quality_gate` setting to `.laneconductor.json` and the `projects` DB table.
3. Update `setup scaffold` to create a default `conductor/quality-gate.md` if the setting is enabled.
4. Update the `review` skill and UI buttons to respect the new workflow: `review` -> `quality-gate` -> `done`.

## Phases
- [ ] Phase 1: Backend & Schema Updates
- [ ] Phase 2: UI Updates
- [ ] Phase 3: Skill & CLI Updates
- [ ] Phase 4: Sync Worker & Template Updates
