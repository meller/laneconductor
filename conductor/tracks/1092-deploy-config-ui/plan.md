# Plan: Deploy Configuration UI (Track 1092)

## Phase 1: API — read/write full deploy config

**Problem**: 1085 only exposes environment *names*
(`GET /api/projects/:id/deploy-environments`), nothing reads or writes the
full config (commands per environment).
**Solution**: A parallel pair of endpoints for the config editor.

- [ ] Task 1: `GET /api/projects/:id/deploy-config` — reads
      `repo_path/conductor/deploy.json`, returns the parsed object (or
      `{ environments: {} }` if missing); 404 only if the project itself
      doesn't exist
- [ ] Task 2: `POST /api/projects/:id/deploy-config` — validates shape
      (REQ-2), writes to `repo_path/conductor/deploy.json` via
      `writeFileSync`, `mkdirSync`-ing `conductor/` first if needed
- [ ] Task 3: Unit tests (Vitest+supertest, mocked `pool`/`fs`, same pattern
      as `ui/server/tests/track-1085-dispatch.test.mjs`) — happy path,
      missing file, invalid shape, project not found

## Phase 2: UI — Deployment section

**Problem**: No UI surface for viewing/editing environments.
**Solution**: New section in `ProjectConfigSettings.jsx`.

- [ ] Task 1: Fetch and render the environment list (name + command) on
      panel open
- [ ] Task 2: Add-environment form (name + single command string for v1 —
      see spec REQ-3 on `commands` array being a stretch goal)
- [ ] Task 3: Edit an existing environment's command inline
- [ ] Task 4: Remove an environment (with a confirm step, matching this
      page's existing delete-confirmation patterns elsewhere)
- [ ] Task 5: Empty state when no `deploy.json` exists yet (REQ-4)
- [ ] Task 6: Save writes the full environments object via
      `POST .../deploy-config`; on success, refetch to confirm

## Phase 3: Cross-check with 1085's Deploy Now control

**Problem**: Two features now read from the same file — need to confirm
they agree.
**Solution**: Manual + automated verification that edits here show up there.

- [ ] Task 1: Confirm `WorkersList.jsx`'s existing `deploy-environments`
      fetch (from 1085) picks up an environment added/removed here without
      needing its own changes — it should, since both read the same file;
      if it doesn't (e.g. a caching issue), fix there
- [ ] Task 2: Decide whether `deploy-environments` (names-only) should be
      deprecated in favor of deriving names from `deploy-config` client-side
      instead of maintaining two endpoints — lean toward keeping both if the
      extra endpoint stays trivial, but make the call during implementation
      rather than upfront

## Phase 4: Tests

- [ ] Task 1: API round-trip — write a config, read it back, matches
- [ ] Task 2: Add/edit/remove an environment via the API, each persists
- [ ] Task 3: Missing `conductor/deploy.json` — `GET` returns empty config,
      not an error; first `POST` creates the file and directory
- [ ] Task 4: Invalid shape rejected with 400 (missing command, wrong type
      for `environments`)

## Phase 5: Smart Defaults & Default Environment Convention

- [ ] Task 1: Update API (`POST /api/projects/:id/deploy-config`) to validate and store `defaultEnvironment`
- [ ] Task 2: Update `GET /api/projects/:id/deploy-environments` to include `defaultEnvironment`
- [ ] Task 3: Add UI in `ProjectConfigSettings.jsx` to select default environment and provide quick convention presets (e.g. `production`, `staging`)
- [ ] Task 4: Update `WorkersList.jsx` to pre-select `defaultEnvironment` in "Deploy Now"
- [ ] Task 5: Add tests for `defaultEnvironment` validation and default pre-selection

