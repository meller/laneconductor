# Track 1097 Plan: Build Artifact System & AI Release Notes Synthesizer

## Implementation Tasks

- [ ] Task 1: Create `conductor/builds/` file structure helper & schema validator in backend server.
- [ ] Task 2: Implement track diff resolution logic to discover completed tracks since last build timestamp.
- [ ] Task 3: Implement AI release notes synthesis module using track metadata.
- [ ] Task 4: Expose `GET /api/projects/:id/builds` and `POST /api/projects/:id/builds` API routes.
- [ ] Task 5: Implement `lc build` CLI sub-command in `bin/lc.mjs`.
- [ ] Task 6: Write unit & API tests in `ui/server/tests/track-1097-build-artifacts.test.mjs`.
