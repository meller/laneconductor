# LaneConductor Workspace Rules

You are the Antigravity agent working on a project orchestrated by LaneConductor. 
LaneConductor is a local-first, multi-agent control plane that coordinates development tasks through Kanban lanes tracked in `conductor/tracks/` and synced to a local database and dashboard.

## Folder Structure

- `conductor/tracks/NNN-slug/` - Directory for each track (where NNN is the 3-digit track number).
  - `index.md` - Canonical status file containing track metadata (Lane, Status, Progress, Phase, etc.).
  - `spec.md` - Technical specification and requirements.
  - `plan.md` - Implementation plan split into phases.
- `conductor/workflow.json` - Defines Kanban lanes, transitions, hooks, and execution constraints.
- `conductor/tracks.md` - Summarized view of all tracks.

## The Conductor Workflow

You MUST strictly follow the lane boundaries defined in `conductor/workflow.json`.

### 1. Planning (`plan` lane)
- **Objective**: Synthesize the specification (`spec.md`) and design the technical approach in `plan.md`.
- **Constraint**: ONLY produce documentation. **NEVER** write or modify application code during this phase.
- **Action**: 
  1. Read the specification in `conductor/tracks/NNN-slug/spec.md`.
  2. Create or update `conductor/tracks/NNN-slug/plan.md`. Outline the implementation phases, tasks, and verification steps.
  3. When the plan is ready, update the metadata header in `index.md` to transition the track to the next lane (typically `ready` or `implement`, check `lanes.plan.on_success` in `workflow.json`).

### 2. Implementation (`implement` lane)
- **Objective**: Execute the implementation plan phase by phase.
- **Action**:
  1. Implement changes in application code following the checklist in `plan.md`.
  2. Periodically update the progress markers in `index.md` (e.g. `**Progress**: 40%`, `**Phase**: Phase 1`).
  3. Keep commits atomic, descriptive, and prefixed with the track number (conventional commits: e.g. `feat(track-NNN): implement something`).
  4. When implementation is complete, transition the track to the `review` lane (check `lanes.implement.on_success` in `workflow.json`).

### 3. Review (`review` lane)
- **Objective**: Perform code verification, linting, and run tests.
- **Constraint**: **NEVER** fix bugs during the review phase. If a check or test fails, transition the track back to the `implement` lane (or the target specified in `lanes.review.on_failure` in `workflow.json`) to perform the fix.
- **Action**:
  1. Run project test suites and linter.
  2. Verify all requirements in `spec.md` are met.
  3. On success, transition to the next lane (`quality-gate` or `done`, as defined in `workflow.json`).

### 4. Quality Gate (`quality-gate` lane)
- **Objective**: Final verification before completion.
- **Action**:
  1. Run end-to-end tests or production build commands.
  2. Transition to `done` on success.

## Metadata Format in `index.md`

Every `index.md` MUST maintain the following metadata format at the top of the file:

```markdown
# Track NNN: Title

- **Lane**: <lane_name>
- **Status**: <status>
- **Progress**: <percent>%
- **Phase**: <current_phase>
- **Last Run**: <agent_cli>/<model> (e.g., antigravity/gemini)
```

## CLI Commands

You can run `lc` commands in the terminal:
- `lc status` - Print a terminal-based Kanban board.
- `lc worker status` - Check the status of the local sync worker.
- `lc worker sync` - Force synchronization between local files and the database/dashboard.
