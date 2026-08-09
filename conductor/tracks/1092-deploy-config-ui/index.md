# Track 1092: Deploy Configuration UI

**Lane**: plan
**Lane Status**: success
**Progress**: 0%
**Phase**: Planning complete
**Type**: dev
**Summary**: Web UI to view/edit conductor/deploy.json's environments, so deploy config isn't CLI-or-hand-edit-only.

## Problem

Track 1085 (Manual Worker Dispatch) added a "Deploy Now" control that reads
`conductor/deploy.json`'s configured environments — but nothing lets you
*create or edit* that file from the app. Today the only ways to get a
`deploy.json` are `lc setup-deploy` (an interactive AI-guided CLI wizard)
or hand-editing the JSON file directly. A user who only interacts with the
web dashboard has no way to see what environments exist, what command(s)
each one runs, or to add/change one — they'd need to drop into a terminal
just to make the dropdown in 1085's "Deploy Now" control show something.

## Solution

- Extend `GET /api/projects/:id/deploy-environments` (added in 1085, currently
  returns just environment names) into a fuller `GET /api/projects/:id/deploy-config`
  returning the full parsed `deploy.json` (environments, each with its
  `command`/`commands`), plus a `POST /api/projects/:id/deploy-config` that
  writes the edited config back to `conductor/deploy.json` on disk —
  mirroring the existing `GET`/`POST /api/projects/:id/workflow` pattern
  exactly (same disk-write-via-`repo_path` approach, same project already
  established).
- New "Deployment" section in `ProjectConfigSettings.jsx` (the existing
  ⚙️ Config panel — already has sibling sections for worker mode, visibility,
  API keys): list configured environments, each showing its command(s);
  add/edit/remove an environment; each environment's command(s) edited as
  plain text (a shell command string), matching how `deploy.json` already
  treats commands as opaque, user-authored strings — no attempt to validate
  or sandbox them.
- Explicitly **not** in scope for v1: porting `lc setup-deploy`'s AI-guided
  wizard (framework detection, IaC questions, generated `deployment-stack.md`)
  into the web UI. That's a materially bigger, different piece of work; this
  track is a plain config editor for a file that already exists (or doesn't
  yet — first save creates it), not a wizard. Users who want the guided
  first-time setup still run `lc setup-deploy` from a terminal once; this
  track is for viewing/editing afterward, or for someone comfortable writing
  a raw deploy command themselves without the wizard.

Full design context for the dispatch mechanism this configures:
[1085](../1085-manual-worker-dispatch/index.md),
[docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md](../../../docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md).

## Phases
- [ ] Phase 1: API — `GET`/`POST /api/projects/:id/deploy-config` (full read/write, not just environment names)
- [ ] Phase 2: UI — "Deployment" section in `ProjectConfigSettings.jsx`: list, add, edit, remove environments
- [ ] Phase 3: Update 1085's `WorkersList.jsx` "Deploy Now" control to point at the new full-config endpoint if the environment-names-only one is superseded (or keep both — decide during implementation)
- [ ] Phase 4: Tests — API read/write round-trip, add/edit/remove an environment, empty/missing deploy.json (first save creates it)

## Depends on
[1085](../1085-manual-worker-dispatch/index.md) — this is the config-editing counterpart to 1085's "Deploy Now" control; without 1085 there'd be nothing to configure *for*.
