# Spec: Deploy Configuration UI (Track 1092)

## Problem Statement

`conductor/deploy.json` is only readable/writable via `lc setup-deploy`
(CLI, AI-guided wizard) or hand-editing the file. Track 1085's "Deploy Now"
control can only dispatch environments that already exist in that file —
there's no way to see or manage them from the app itself.

## Requirements

**REQ-1: Read full deploy config**
- `GET /api/projects/:id/deploy-config` — returns the full parsed
  `deploy.json` (all environments, each with `command` or `commands`), not
  just environment names (contrast with 1085's
  `GET /api/projects/:id/deploy-environments`, which stays as-is for the
  lightweight "Deploy Now" dropdown — this is a separate, fuller endpoint
  for the config editor).
- Same disk-read approach as 1085's environments endpoint: reads
  `repo_path/conductor/deploy.json` directly, not from `conductor_files`
  (deploy.json isn't synced into that JSONB column). Returns
  `{ environments: {} }` if the file doesn't exist yet — not a 404 or 500,
  since "no deploy.json yet" is the normal starting state for a project
  that's never run `lc setup-deploy`.

**REQ-2: Write full deploy config**
- `POST /api/projects/:id/deploy-config { environments: {...} }` — writes
  the given config to `repo_path/conductor/deploy.json`, creating the file
  (and `conductor/` dir, if somehow missing) if it doesn't exist.
- Validates the shape server-side: `environments` must be an object; each
  entry must have either a non-empty `command` string or a non-empty
  `commands` array of `{ label, command }` objects — reject with a clear
  400 otherwise, mirroring how `lc deploy`/`runDeploy` already validate this
  shape when *running* a deploy.
- No validation of whether the command(s) actually work — `deploy.json`
  commands are, and remain, arbitrary user-authored shell strings, same
  trust model as today.

**REQ-3: UI — Deployment section in Project Config**
- New section in `ui/src/pages/ProjectConfigSettings.jsx`, alongside the
  existing worker-mode/visibility/API-keys sections.
- Lists each configured environment: name, its command(s).
- Add environment: name + a single command string (the common case;
  `commands` array with per-step labels is a stretch goal, not required for
  v1 — REQ-2's API supports it, but the v1 UI can start with the
  single-`command` shape only and grow into `commands` later).
- Edit an environment's command; remove an environment.
- Save calls `POST .../deploy-config` with the full updated environments
  object (not a partial patch — matches how the workflow.json config
  section already works in this same page).

**REQ-4: Empty/first-time state**
- If no `deploy.json` exists yet, the section shows an empty state ("No
  deploy environments configured yet") with an "Add environment" action —
  not an error, not a prompt to go run a CLI wizard instead.

**REQ-5: Default environment & convention presets**
- `conductor/deploy.json` supports an optional `defaultEnvironment` property
  (e.g., `"defaultEnvironment": "production"`).
- `POST /api/projects/:id/deploy-config` validates `defaultEnvironment`: if set,
  it must match one of the environment keys in `environments`.
- `GET /api/projects/:id/deploy-environments` returns `{ environments, defaultEnvironment }`
  so consumer components (like `WorkersList.jsx`) can pre-select the default environment.
- The UI in `ProjectConfigSettings.jsx` allows marking an environment as default
  and offers quick preset options (e.g. Production/Staging templates with standard commands).

## Acceptance Criteria

- [ ] `GET /api/projects/:id/deploy-config` returns the full config, or
      `{ environments: {} }` when no `deploy.json` exists
- [ ] `POST /api/projects/:id/deploy-config` writes `conductor/deploy.json`,
      creating `conductor/` if missing
- [ ] Invalid shape (missing `command`/`commands`, non-object `environments`, or invalid `defaultEnvironment`)
      is rejected with a 400 and a clear message
- [ ] Adding an environment via the UI makes it appear in 1085's "Deploy Now"
      dropdown on next load (proves the two features are reading the same
      underlying file/data correctly)
- [ ] Editing a command or setting a default environment persists across a page reload
- [ ] Removing an environment removes it from both this UI and 1085's dropdown
- [ ] A project with no `deploy.json` shows the empty state, not an error
- [ ] Default environment is auto-selected in the "Deploy Now" dropdown when available
