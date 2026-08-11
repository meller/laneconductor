# Track 1097 Specification: Build Artifact System & AI Release Notes Synthesizer

## Objective
Evolve LaneConductor from a "head-push" deployment system to an **Artifact-Based Release System** by generating immutable release artifacts (`build-<timestamp>.json`) containing Git commit metadata, included track IDs, and AI-synthesized release notes.

## Requirements

### 1. Build Artifact Schema (`conductor/builds/<build_id>.json`)
Each build file must be stored on disk in the project repo under `conductor/builds/` (created if missing) with the following structure:
```json
{
  "id": "build-20260810-163000",
  "createdAt": "2026-08-10T16:30:00Z",
  "git": {
    "commit": "a1b2c3d4e5f67890",
    "shortCommit": "a1b2c3d",
    "branch": "main"
  },
  "tracks": ["1085", "1092"],
  "summary": {
    "title": "Release Build 20260810-163000",
    "markdown": "### Features\n- Added deploy config UI...\n\n### Fixes\n- Fixed preset reset issue...",
    "categories": {
      "features": ["Deploy Configuration UI (Track 1092)"],
      "fixes": ["Preset Reset Validation"],
      "improvements": []
    }
  },
  "createdBy": "meller"
}
```

### 2. Backend API
- `GET /api/projects/:id/builds`: List all build artifacts in `conductor/builds/` ordered by creation date descending.
- `POST /api/projects/:id/builds`: Trigger creation of a new build artifact.
  - Scans `conductor/tracks/` for tracks in `lane: done` updated after the `createdAt` timestamp of the previous build (or all done tracks if no build exists).
  - Collects `index.md`, `spec.md`, and `plan.md` from those tracks.
  - Calls AI summary logic to synthesize structured Markdown release notes.
  - Writes the JSON artifact to `conductor/builds/<build_id>.json`.

### 3. CLI Command (`lc build`)
- Adds `lc build` CLI command to create release builds directly from the command line.

## Non-Goals
- UI rendering of builds drawer (deferred to Track 1098).
- Execution of deployments with build IDs (deferred to Track 1098).
