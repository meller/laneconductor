# Plan: Track 1071 — CLI Help Scoped Sections

## Phase 1: Rewrite help text in bin/lc.mjs

**Problem**: Help string is one flat block, no scope indication.
**Solution**: Replace the `console.log(...)` help block with scoped sections.

- [x] Task 1: Identify the exact line range of the help string in `bin/lc.mjs` (currently around line 394–453)
- [x] Task 2: Rewrite into sections:
  - `Shared Infrastructure` — api, ui
  - `Project Setup` — setup, setup-deploy, install
  - `Worker` — start, stop, restart, worker [...]
  - `Track Management` — new, brainstorm, comment, move, pulse, show, logs, delete
  - `Track Transitions` — plan, implement, review, quality-gate, backlog, done, rerun
  - `Configuration` — config, workflow, add-target and friends, verify-isolation, project, doc
  - `Deployment` — deploy, remote-sync, init-summary, verify
- [x] Task 3: Verify `lc --help`, `lc help`, `lc -h` all render the new output

## Phase 2: Remove `lc install` command

**Problem**: `lc install` installs chokidar in the project directory, but the worker runs from the laneconductor repo where chokidar is already a dep. The command is a no-op for any user who ran `make install`.
**Solution**: Remove from help, comment out handler, update landing page, wiki, and SKILL.md.

- [x] Task 1: Remove `install` from help text in bin/lc.mjs
- [x] Task 2: Comment out install command handler in bin/lc.mjs
- [x] Task 3: Fix post-setup "Next steps" hint (removed `lc install` step, clarified ui/worker scope)
- [x] Task 4: Update landing/index.html — step 02 now just `lc setup`, step 03 shows both `lc ui start && lc start`
- [x] Task 5: Update landing/wiki.html — removed `lc install` from project setup snippet
- [x] Task 6: Update SKILL.md — removed from quick reference and activate checklist

## ✅ COMPLETE

**Impact**: New users immediately understand the machine/project boundary.
