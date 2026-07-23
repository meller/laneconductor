# Track LAN-107: Implementation Plan

## Phase 1: `user-stories.md` scaffold generation

- [x] Added `user-stories.md` to the skill's scaffold-generation file list (both the
      `setup scaffold generate` section, alongside `product.md`/`tech-stack.md`/etc., and the
      Mode A/B section of `setup scaffold`).
- [x] Added the template shown in spec.md's REQ-2 (persona/journey/steps, stub if unknown).
- [x] Instructed to seed from `brainstorm_summary` if it mentions concrete user journeys, else
      stub (same pattern as `design-language.md`).

## Phase 2: Sync fix — close the orphaned-docs gap

- [x] `conductor/laneconductor.sync.mjs`'s `syncConductorFiles()`: added `kpis`,
      `deployment_stack`, `design_language`, `user_stories` keys via the existing
      `readIfExists(\`${dir}/<file>.md\`)` pattern.
- [x] Also added all four filenames to the chokidar `watch([...])` list further down in the same
      file (a *second* place the file list was hardcoded — found during implementation; without
      this, editing any of the four wouldn't trigger a live re-sync even though the builder itself
      was fixed).
- [x] Confirmed no DB migration needed — `conductor_files` is a JSONB blob column, purely additive.

## Phase 3: UI fix

- [x] `ui/src/components/ConductorPanel.jsx`: added `design_language`, `deployment_stack`, `kpis`,
      `user_stories` to `TABS`.
- [x] Confirmed `MarkdownRenderer` needed no special-casing — generic `files[tabKey]` lookup and
      null-safe "No content available." fallback already handled it.

## Phase 4: Verify

- [x] Live-verified against two real projects rather than a disposable test one: `laneconductor`
      itself (wrote a real `conductor/user-stories.md`) and `coachai`/`aitutor` (already had
      `kpis.md`/`deployment-stack.md`/`design-language.md` from an earlier session).
- [x] Confirmed via direct DB query (`select jsonb_object_keys(conductor_files) from projects`)
      that all four new keys populated with real content lengths (e.g. `design_language`: 10937
      chars, `deployment_stack`: 9672 chars for the aitutor project).
- [x] Confirmed live in the actual dashboard via Playwright: Design/Deployment/KPIs/User Stories
      tabs all render, Deployment tab showing real "Deployment Stack... Last verified 2026-07-19
      (Track 132)..." content.
- [x] **Important operational finding**: each registered project runs its *own* `laneconductor.sync.mjs`
      process (`ps aux` showed 3 separate instances, one per project, each tracked by its own
      `conductor/.sync.pid`) — a code change to the shared canonical `sync.mjs` requires restarting
      **every** affected project's worker (`lc worker restart`, run with that project as cwd), not
      just one. Initially missed this: restarted only the `laneconductor` project's own worker,
      and `aitutor`/coachai's separate (older) worker kept serving stale code until restarted
      too — user caught this by reporting most tabs still empty on their project.
- [x] Confirmed no regression: `product`/`tech_stack`/`product_guidelines` tabs (already-populated
      before this track) unaffected.

## Success Criteria

- [x] spec.md's acceptance criteria met.
- [x] coachai (and any other project whose worker has been restarted) can generate, edit, and see
      `user-stories.md`/`kpis.md`/`deployment-stack.md`/`design-language.md` in the dashboard.

## ✅ REVIEWED

## ✅ QUALITY PASSED
