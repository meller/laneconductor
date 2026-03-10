# Spec: Quality Gate Lane and Project Setting

## Problem Statement
The current LaneConductor workflow transitions tracks directly from `review` to `done`. Many projects require an automated or manual quality check (Quality Gate) after the peer review is finished but before the feature is considered complete. This track introduces a dedicated `quality-gate` lane and a project-level setting to enable it.

## Requirements

### REQ-1: Quality Gate Lane
- The system must support a new `lane_status` value: `quality-gate`.
- This lane must be positioned between `review` and `done` in the Kanban board.

### REQ-2: Project Setting
- Add a `create_quality_gate` boolean flag to the `projects` table and `.laneconductor.json`.
- When `true`, the project is considered to have a quality gate enabled.

### REQ-3: Default Quality Gate Template
- If `create_quality_gate` is enabled, the `setup scaffold` command must create a `conductor/quality-gate.md` file.
- The template should include stubs for:
    - Unit Test Coverage
    - Linting Results
    - Build Verification
    - Security Scans (optional)

### REQ-4: Workflow Integration
- **Manual Transition**: UI "Next" button should move `review` -> `quality-gate` (if enabled) and `quality-gate` -> `done`.
- **Review Skill**: `/laneconductor review` should transition a track to `quality-gate` upon PASS if the setting is enabled.
- **Sync Worker**: Recognizes markers for the new lane.
    - `✅ REVIEWED` moves to `quality-gate` if enabled.
    - `✅ QUALITY PASSED` (new marker) moves to `done`.

### REQ-5: API & UI
- `VALID_LANES` in the Express API must be updated.
- `LANES` array in `KanbanBoard.jsx` must be updated.
- `TrackCard.jsx` styles and transition labels must be updated.

## Acceptance Criteria
- [ ] `PATCH /api/projects/:id/tracks/:num` accepts `quality-gate` as a valid status.
- [ ] Kanban board shows 6 columns: Backlog, Planning, In Progress, Review, Quality Gate, Done.
- [ ] `.laneconductor.json` includes `project.create_quality_gate`.
- [ ] Running `/laneconductor setup scaffold` in a new project with the setting enabled creates `conductor/quality-gate.md`.
- [ ] A track in the `review` lane shows "→ Quality Gate" on its action button if enabled.
- [ ] `/laneconductor review` on a PASS moves the track to the `quality-gate` lane.
- [ ] The sync worker correctly updates the DB status when `✅ QUALITY PASSED` is added to a `plan.md`.

## Data Models

### Project Setting
```json
{
  "project": {
    "create_quality_gate": true
  }
}
```

### New Markers
- `✅ QUALITY PASSED` -> moves track to `done`
- `✅ REVIEWED` -> moves track to `quality-gate` (if enabled) or `done` (if disabled)
