# Tests: Track 10014 — Project management page

## Test Commands
```bash
# Backend (Vitest + supertest, mocked pg — matches ui/server/tests/*)
cd ui && npm test -- track-10014

# Frontend components (same Vitest run, jsdom)
cd ui && npm test -- ProjectsPage
cd ui && npm test -- ConductorPanel

# Full suite (regression check before quality-gate)
cd ui && npm test
```

## Test Cases

### Phase 1: Rename & Delete API
- [ ] TC-1: `PATCH /api/projects/1` with `{ name: "Renamed" }` — expected:
      200, `projects.name` updated in DB.
- [ ] TC-2: `PATCH /api/projects/1` with `{ name: "" }` — expected: 400,
      name unchanged.
- [ ] TC-3: `DELETE /api/projects/1` (no body) — expected: 200, project row
      gone, its tracks/workers gone too (cascade), local files untouched.
- [ ] TC-4: `DELETE /api/projects/1` with `{ deleteLocalFiles: true }` on a
      project whose `repo_path` exists on disk — expected: 200,
      `conductor/` and `.laneconductor.json` removed, `.git` untouched.
- [ ] TC-5: `DELETE /api/projects/1` with `{ deleteLocalFiles: true }` on a
      project whose `repo_path` does NOT exist locally (remote-only) —
      expected: 200, no throw, `localFilesDeleted: false`.
- [ ] TC-6: `DELETE /api/projects/999` (nonexistent) — expected: 404.

### Phase 2: Editable conductor files
- [ ] TC-7: `PATCH /api/projects/1/conductor/product` with
      `{ content: "# New Product Doc" }` — expected: 200,
      `conductor_files.product` updated, and (if `repo_path` exists)
      `conductor/product.md` on disk matches.
- [ ] TC-8: Same for `kpis` and `tech_stack` keys.
- [ ] TC-9: `PATCH /api/projects/1/conductor/not_a_real_key` — expected:
      400, no DB write.
- [ ] TC-10: `PATCH` on a project with no local `repo_path` — expected:
      200, DB updated, no disk write attempted (no throw from a missing
      path).

### Phase 3: Projects page
- [ ] TC-11: `ProjectCard` given a project + a `tracks` array containing
      entries for other projects too — expected: lane-count chips reflect
      ONLY that project's tracks (no leakage across projects).
- [ ] TC-12: `ProjectCard` given a worker with `last_heartbeat` 30s ago —
      expected: shown as online/Active; 120s ago — expected: Offline.
- [ ] TC-13: Manual: open the Projects tab with zero projects selected —
      expected: grid renders (tab not gated behind a selection, unlike
      Worktrees).
- [ ] TC-14: Manual: click "Open" on a card — expected: `selectedProjectId`
      updates and the view switches to Lanes for that project.

### Phase 4: Rename & Delete UI
- [ ] TC-15: Manual: rename a project via the modal, reload the page —
      expected: new name persists.
- [ ] TC-16: Manual: Delete modal's confirm button stays disabled until the
      typed text matches the project name exactly.
- [ ] TC-17: Manual: delete the currently-selected project — expected: app
      falls back to the Projects tab, not a broken Lanes view for a project
      that no longer exists.

### Phase 5: Editable ConductorPanel
- [ ] TC-18: Manual: open Context panel, edit the `product` tab, Save,
      close and reopen the panel — expected: edited content shown (not the
      stale pre-edit content).
- [ ] TC-19: Manual: Cancel during edit — expected: original content
      restored, no API call made.
- [ ] TC-20: Manual: the `workflow` tab and any `sg_*` styleguide tabs do
      NOT show an Edit button (out of allow-list).

## Acceptance Criteria
- [ ] All automated tests above pass (`cd ui && npm test`)
- [ ] No regressions in the existing full `ui` Vitest suite
- [ ] Manual TCs (13, 14, 15, 16, 17, 18, 19, 20) walked through in a real
      running instance (`make lc-ui-start`) with actual screenshots or
      recorded API/DB responses as evidence per the quality-gate's
      real-product check — not just "the code looks correct"
- [ ] Phase 6 remains unchecked and is excluded from any "done" claim
