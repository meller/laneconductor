# Track 10014: Project management page

## Phase 1: Backend — Rename & Delete project

**Problem**: There is no way to rename or delete a project anywhere in the
API. `projects.name` exists but is never PATCHed; there's no DELETE route
at all for `/api/projects/:id`.
**Solution**: Add both routes in `ui/server/index.mjs`, next to the
existing `/api/projects/:id/config` handlers. Delete relies on the
cascading FKs already declared in `prisma/schema.prisma` — a plain `DELETE
FROM projects WHERE id = $1` cleans up tracks/workers/comments/dispatch
rows/etc. automatically. `deleteLocalFiles` is opt-in and disk-only
(`rmSync` on `conductor/` and `.laneconductor.json` under `repo_path`,
guarded by `existsSync`) — never shells out to `git`.

- [x] Task 1: `PATCH /api/projects/:id` — validate non-empty `name`, update
      `projects.name`, return the updated name.
- [x] Task 2: `DELETE /api/projects/:id` — 404 if missing; `DELETE FROM
      projects WHERE id = $1`; if `deleteLocalFiles === true` and
      `repo_path` exists on disk, `rmSync(join(repo_path, 'conductor'),
      { recursive: true, force: true })` and remove
      `.laneconductor.json`; respond with `{ ok: true, localFilesDeleted }`.
- [x] Task 3: Tests in `ui/server/tests/track-10014-project-crud.test.mjs`
      covering: rename happy path, rename with empty name (400), delete
      without `deleteLocalFiles` (DB-only), delete with `deleteLocalFiles`
      on a project whose `repo_path` doesn't exist on this machine
      (shouldn't throw), delete of a nonexistent id (404). 7/7 pass.

**Impact**: A project can be renamed or fully removed via the API. No
schema migration required.

## Phase 2: Backend — Editable conductor context files

**Problem**: `conductor_files` (product.md, tech-stack.md, kpis.md, etc.)
can only be read (`GET /api/projects/:id/conductor`) or written by the
sync worker watching the filesystem — never edited from the UI, even
though `workflow.json` already has exactly this write-through pattern via
`POST /api/projects/:id/workflow`.
**Solution**: Add one generic endpoint that generalizes that existing
pattern across the other conductor-file keys, guarded by an allow-list so
arbitrary keys/paths can't be written.

- [x] Task 1: `PATCH /api/projects/:id/conductor/:key` in
      `ui/server/index.mjs`. Allow-list: `product` → `product.md`,
      `tech_stack` → `tech-stack.md`, `product_guidelines` →
      `product-guidelines.md`, `design_language` → `design-language.md`,
      `deployment_stack` → `deployment-stack.md`, `kpis` → `kpis.md`,
      `user_stories` → `user-stories.md`, `quality_gate` →
      `quality-gate.md`. 400 on unknown key.
- [x] Task 2: Same disk write-through as `/workflow` — only if
      `existsSync(repo_path)`.
- [x] Task 3: Emit the existing `conductor:updated` WS event (already
      broadcast by `POST /conductor-files`) so any open `ConductorPanel`
      live-refreshes — reuse `notifyApi`/`wsBroadcast`, matching the call
      already made in `syncConductorFiles()`.
- [x] Task 4: Tests: edit `product`, edit `kpis`, unknown key → 400, edit on
      a project with no local `repo_path` (remote-only) still succeeds
      (DB-only write, no disk write attempted). 5/5 pass.

**Impact**: The write-through pattern used today only for `workflow.json`
now covers the human-editable context docs, closing the gap noted in
`product.md`'s own File Roles table ("written by humans, Claude").

## Phase 3: Frontend — Projects page (card grid)

**Problem**: `ProjectSelector` is a bare dropdown; there is no overview of
all projects at once.
**Solution**: New `ui/src/components/ProjectsPage.jsx` (+ `ProjectCard.jsx`)
rendered from a new `viewMode: 'projects'` branch in `App.jsx`'s `<main>`,
alongside the existing Lanes/Workers/CI/CD/Worktrees branches, and a new
always-visible "Projects" nav button (unlike "Worktrees", not gated behind
`selectedProjectId`).

- [x] Task 1: `ProjectCard` computes, from props already available in
      `AppContent` (`projects`, `tracks`, `workers` — no new fetch):
      lane-count chips (group that project's tracks by `lane_status`),
      worker-online indicator (`workers` for this project with
      `last_heartbeat` within 60s — same threshold used server-side at
      `ui/server/index.mjs:3436`), unreplied-comment count (sum
      `unreplied_count`, same field `App.jsx`'s inbox badge already sums),
      and a computed status badge: `Offline` / `Needs Attention` (unreplied
      comments) / `Active` (worker online + tracks in
      implement/review/quality-gate) / `Idle`.
- [x] Task 2: `ProjectsPage` renders a responsive grid of `ProjectCard`s
      (Tailwind `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`, matching
      the existing grid patterns already used in `KpiRollupPanel`).
- [x] Task 3: Card actions — **Open**: calls the same
      `setSelectedProjectId` + `setViewMode('lanes')` App.jsx already uses
      for `ProjectSelector`. **Manage Context**: same selection, plus
      `setConductorOpen(true)`.
- [x] Task 4: Wire the "Projects" nav button into `App.jsx`'s header tab
      group and the `<main>` view-mode switch.

**Impact**: Users get a single overview page instead of hunting through a
dropdown + per-project panels.

## Phase 4: Frontend — Rename & Delete UI

**Problem**: No UI exists to call Phase 1's new endpoints.
**Solution**: Two small components, wired into `ProjectCard`'s action row.

- [x] Task 1: `RenameProjectModal.jsx` — single text input, prefilled with
      current name, calls `PATCH /api/projects/:id`.
- [x] Task 2: `DeleteProjectModal.jsx` — explains this removes the project
      from LaneConductor (tracks, workers, history — irreversible), a
      "type the project name to confirm" input (disables the Delete button
      until it matches, mirroring the destructive-action pattern this repo
      already uses for hard-deleting tracks), and a separate, unchecked-by-
      default "Also delete `conductor/` and `.laneconductor.json` from
      disk" checkbox with its own explicit "does not touch git" caption.
      Calls `DELETE /api/projects/:id`.
- [x] Task 3: On successful delete, if the deleted project was
      `selectedProjectId`, clear the selection and switch back to the
      Projects tab (avoid landing on a Lanes view for a project that no
      longer exists).

**Impact**: Rename/Delete are reachable from the card grid end-to-end.

## Phase 5: Frontend — Editable ConductorPanel

**Problem**: `ConductorPanel` only renders `MarkdownRenderer` — no edit
mode — even though Phase 2 now has an endpoint to save changes.
**Solution**: Add a per-tab Edit/Save/Cancel toggle to
`ui/src/components/ConductorPanel.jsx`: Edit swaps `MarkdownRenderer` for a
plain `<textarea>` seeded with the current content; Save calls Phase 2's
`PATCH /api/projects/:id/conductor/:key` and refetches; Cancel discards.
Applies uniformly to every tab already listed in `TABS` (`product`,
`tech_stack`, `product_guidelines`, `design_language`, `deployment_stack`,
`kpis`, `user_stories`, `quality_gate`) — `workflow` is excluded (already
has its own dedicated `WorkflowSettings` editor) and the dynamically-added
`sg_*` styleguide tabs are excluded (no allow-listed key for arbitrary
styleguide files in Phase 2 — out of scope, styleguides aren't part of the
explicit "kpi, product, techspec" ask).

- [x] Task 1: Edit mode state (`editing: boolean`, `draft: string`) per
      panel, reset when `tab` changes.
- [x] Task 2: Save button — disabled while saving, shows inline error on
      failure (matching `ProjectConfigSettings`'s `notification` pattern).
- [x] Task 3: Only show the Edit button for tabs present in Phase 2's
      allow-list.

**Impact**: "manage their context - kpi, product, techspec" from the
track's problem statement is fully addressed — edits round-trip through
the DB and, for local projects, the filesystem.

## Phase 6 (Deferred / FFU — not part of this track's "done"): Smart AI project action

**Problem**: The track floats an optional idea — "include smart ai action
and pass to the worker to do if you think about something creative."
**Solution sketch** (not implemented this pass — see spec.md's "Out of
scope" section for why): a `refresh-context` action added to
`POST /api/projects/:id/dispatch`'s existing per-action branches, enqueued
into the already-existing free-text `worker_dispatch.action` column (no
migration needed), picked up by the worker the same way `deploy` dispatch
already is, running a non-interactive pass that re-derives
`product.md`/`tech-stack.md` from the current repo and writes them back
through Phase 2's endpoint.

- [ ] Task 1 (FFU): Worker-side handling in `laneconductor.sync.mjs` for a
      `refresh-context` dispatch action.
- [ ] Task 2 (FFU): UI affordance on `ProjectCard` to trigger it and show
      dispatch progress (reusing `NewProjectModal`'s poll-the-dispatch-row
      pattern).

**Impact**: None yet — intentionally deferred. Do not check these boxes or
count this phase toward completion; per the skill's done-gate, a track may
only reach 100%/`done` when every capability named in the Solution
actually works, and this one is explicitly out of scope for this pass.

## ✅ COMPLETE

Phases 1-5 implemented with TDD (test written and confirmed failing before
each implementation). 15 new automated tests added (7 backend rename/delete,
5 backend conductor-file edit, 3 ProjectCard, 3 DeleteProjectModal,
3 ConductorPanel edit-mode) — all pass. Full suite: 339/350 pass, the same
11 pre-existing failures both before and after this track's changes
(Firebase-auth-config tests and two files with an unrelated broken
`child_process` mock — verified unrelated by inspecting the failures
directly; none are in files this track touched). `npx vite build` succeeds.

Manually verified end-to-end in a real running instance (isolated API+UI on
ports 8191/8190 pointed at the shared dev Postgres, so as not to disturb the
already-running shared dev servers other tracks depend on), against a
disposable test project (id 1004, deleted at the end of the walkthrough):
Projects tab reachable with no project selected; card shows real lane
counts/status; Manage Context → edited product.md → saved → confirmed the
new content both round-tripped through the DB and was written to
`conductor/product.md` on disk; Rename → confirmed new name in the DB;
Delete → confirm-button stayed disabled until the typed name matched exactly,
then deleting with "also delete local files" checked removed both
`conductor/` and `.laneconductor.json` from disk and the DB row, and the app
fell back to the Projects tab cleanly (no broken Lanes view for a
now-deleted project).

Phase 6 (smart AI context-refresh action) intentionally left unimplemented —
see spec.md's "Out of scope for this pass" and Phase 6 above.

## ✅ REVIEWED

Review complete and passed. All requirements, automated tests (21/21 passing), component builds, and backend write-through behaviors validated. Moving to `quality-gate:queue`.

## ✅ QUALITY PASSED

Quality Gate execution completed and passed:
- Syntax check passed (`node --check` across conductor, ui, bin)
- Critical files verified
- Config validation passed
- Command reachability verified (`make help && lc --version`)
- Track-specific tests passed (12/12 passing across CRUD and conductor-edit test suites)
- Component tests passed (9/9 passing across ProjectCard, DeleteProjectModal, ConductorPanel)
- Full server test suite: 289 passed, 11 pre-existing failures (auth/mock) unchanged
- Full frontend test suite: 50/50 tests passed
- Production build succeeded (`npx vite build`)
- Playwright fast tier E2E suite: 11 passed, 6 skipped, 0 failed
- Zero stub / deferred-work in completed paths; Phase 6 scope correctly deferred
- Transitioning to `done:success`.

