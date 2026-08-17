# Spec: Project management page

## Problem Statement
LaneConductor has no place to see all projects at a glance or manage a
project's identity. Today `ProjectSelector` is a bare `<select>` dropdown,
`ConductorPanel` is a read-only viewer of a project's context files
(product.md, tech-stack.md, kpis.md, etc.), and there is no rename or
delete for a project anywhere in the API or UI. Users have to shell out to
edit `conductor/*.md` files by hand and there's no visual overview of
"what state is each of my projects in."

## Solution
Add a "Projects" view to the existing single-page dashboard (no router is
used today — `App.jsx` toggles between view modes with local state, so this
follows the same pattern as the existing Lanes/Workers/CI/CD tabs):

1. A grid of project cards, computed entirely from data the app already
   polls (`projects`, `tracks`, `workers` from `usePolling` — confirmed
   `usePolling` already fetches ALL tracks/workers, not just the selected
   project's, whenever `projectId` is null). No new summary endpoint is
   needed.
2. Each card shows identity (name, repo path, mode, primary CLI/model), a
   computed status badge, and lane-count chips.
3. Card actions: **Open** (select project, switch to Lanes view), **Manage
   Context** (opens the existing `ConductorPanel`, now editable),
   **Rename**, **Delete**.
4. `ConductorPanel`'s existing tabs (already fetching `conductor_files` via
   `GET /api/projects/:id/conductor`) gain an edit mode, generalizing the
   write-through pattern already used by `POST /api/projects/:id/workflow`
   (update `conductor_files` JSONB, then also write the file to disk when
   `repo_path` exists locally) to `product`, `tech_stack`, `kpis`, and the
   other conductor-file tabs.
5. Rename updates `projects.name` (already a plain column, no migration
   needed). Delete removes the DB row — every `project_id` FK in
   `prisma/schema.prisma` is already `onDelete: Cascade`, so tracks,
   workers, comments, dispatch rows, etc. all clean up automatically — with
   an option to also remove `.laneconductor.json` and `conductor/` from
   disk. Per the track's own scope note, delete **never** touches git (no
   branch deletion, no repo removal) — it only ever removes LaneConductor's
   own bookkeeping (DB row + optionally the `conductor/` folder and
   `.laneconductor.json`).

### Out of scope for this pass (FFU)
The track description floats an optional "smart AI action" (e.g. "maybe
project status etc") if something creative comes to mind. The concrete,
low-risk version of this — a computed status badge per card (Active / Needs
Attention / Offline, from existing lane/heartbeat/unreplied-comment data) —
is in scope and built in Phase 3. A more ambitious version — a worker­
dispatched action that has the AI re-derive `product.md`/`tech-stack.md`
from the current codebase — is **not** built in this pass. It's
technically straightforward to add later (the `worker_dispatch.action`
column is free-text, no enum/migration required, and
`POST /api/projects/:id/dispatch` already has an established per-action
branch pattern to extend), but it's genuinely optional per the track
description and adds real scope (new worker-side handling in
`laneconductor.sync.mjs`, a new prompt/flow for the dispatched agent, UI to
show dispatch progress). Deferred as Phase 6 — not counted toward this
track's "done" acceptance criteria.

## Requirements
- REQ-1: `GET /api/projects` data (already returned) plus already-polled
  `tracks`/`workers` must be sufficient to render every card stat client-side
  — no N+1 per-project fetch.
- REQ-2: `PATCH /api/projects/:id` renames a project (`{ name }` body,
  reject empty/whitespace-only names).
- REQ-3: `DELETE /api/projects/:id` deletes a project's DB row (relying on
  existing cascade FKs) and, when the request body includes
  `deleteLocalFiles: true` AND `repo_path` exists locally, also removes
  `.laneconductor.json` and the `conductor/` directory from disk. Never
  invokes any `git` command.
- REQ-4: `PATCH /api/projects/:id/conductor/:key` edits one conductor file
  by key (allow-listed: `product`, `tech_stack`, `product_guidelines`,
  `design_language`, `deployment_stack`, `kpis`, `user_stories`,
  `quality_gate`) — writes `conductor_files[key]` in the DB and, when
  `repo_path` exists locally, the corresponding file on disk. Unknown keys
  return 400.
- REQ-5: A new "Projects" nav tab renders `ProjectsPage`, a responsive card
  grid, reachable regardless of whether a project is currently selected
  (existing tabs like Worktrees only appear once a project is selected;
  Projects must NOT have that restriction since its purpose is picking
  between projects).
- REQ-6: Each card shows: name, repo path, mode (`local-fs`/`local-api`/
  `remote-api`), primary CLI/model, lane-count chips (from that project's
  slice of the already-fetched `tracks` array), a worker-online indicator
  (from that project's slice of `workers`, heartbeat within the last 60s —
  matching the threshold already used server-side in
  `POST /api/projects/:id/dispatch`), and an unreplied-comment count (sum
  of `unreplied_count` — same field the existing inbox badge in `App.jsx`
  already sums).
- REQ-7: Delete requires typing the project's name to confirm (matches the
  track's own note that this is destructive and the skill's "hard-to-
  reverse operations" guidance) and clearly separates "remove from
  LaneConductor" from the "also delete local files" checkbox — both default
  to the safer / narrower choice.
- REQ-8: Rename and Manage-Context actions must not require navigating away
  from the Projects grid first (rename is inline or a small modal; Manage
  Context opens `ConductorPanel` and also selects the project so subsequent
  Lanes/Workers/etc. tabs reflect it).

## Acceptance Criteria
- [ ] From the Projects tab, a user sees every project as a card, with real
      lane-count and worker-status data (verified against the DB, not
      placeholder text).
- [ ] Renaming a project via the UI persists — reload the page and the new
      name is still shown, and `SELECT name FROM projects WHERE id = ...`
      confirms the DB value changed.
- [ ] Deleting a project via the UI removes it from the Projects grid,
      removes its tracks from the Kanban board, and a direct `GET
      /api/projects/:id/tracks` for that id returns empty/404 afterward.
- [ ] Editing the `product` (or `tech_stack`/`kpis`) tab in `ConductorPanel`,
      saving, and then re-opening the panel shows the saved content — and
      for a project with a local `repo_path`, `conductor/product.md` on
      disk contains the new content too (not just the DB row).
- [ ] Deleting a project with `deleteLocalFiles` unchecked leaves
      `conductor/` and `.laneconductor.json` untouched on disk; checking it
      removes them; in neither case does `.git` change.
- [ ] The Projects tab is visible and usable with no project selected
      (unlike Worktrees, which the existing code gates behind a selection).

## API Contracts / Data Models
No schema migration — `projects.name`, `projects.conductor_files` (JSONB),
and cascading FKs already exist. Endpoints follow the exact write-through
pattern already established by `POST /api/projects/:id/workflow` (lines
~947-971 of `ui/server/index.mjs`) and `PATCH /api/projects/:id/config`
(line ~1055): update `conductor_files` in Postgres, then `writeFileSync` to
the corresponding path under `repo_path` only if `existsSync(repo_path)`.

```
PATCH /api/projects/:id
  body: { name: string }
  → 200 { ok: true, name }
  → 400 if name is empty/whitespace

DELETE /api/projects/:id
  body: { deleteLocalFiles?: boolean }
  → 200 { ok: true, localFilesDeleted: boolean }
  → 404 if project not found

PATCH /api/projects/:id/conductor/:key
  body: { content: string }
  → 200 { ok: true }
  → 400 if :key not in the allow-list
  → 404 if project not found
```
