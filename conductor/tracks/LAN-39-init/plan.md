# Track 004: Init Setup Verification

## Phase 1: End-to-end setup test ✅ COMPLETE

**Problem**: Confirm the full setup flow works on a real project.

- [x] Task 1: Create temp test project (`/tmp/lc-test-project`, `npm init -y`)
- [x] Task 2: Verify scaffold output
    - [x] `conductor/` dir created with all files
    - [x] Skill symlinked into `.claude/skills/laneconductor` → correct canonical path
    - [x] `Makefile` has all 6 lc-* targets
- [x] Task 3: Verify collection output
    - [x] Agent CLIs verified reachable (claude 2.1.50, gemini 0.29.5)
    - [x] `.laneconductor.json` written with `project.id` populated (id=2)
    - [x] DB has project row with primary/secondary agent config

## Phase 2: Fix issues found ✅ COMPLETE

**Issues found and fixed:**

1. **`LC_REPO` path calculation wrong** — `dirname` called twice on SKILL_DIR, but SKILL_DIR
   is 3 levels deep from repo root (`.claude/skills/laneconductor`). Fixed to 3x dirname.

2. **chokidar glob pattern fails on some filesystems** — `conductor/tracks/**/*.md` glob
   doesn't fire 'add' events on tmpfs and potentially other filesystems. Fixed to watch
   `conductor/tracks` directory directly and filter for `.md` in the event handler.

- [x] Task 1: Document issues (above)
- [x] Task 2: Fix SKILL.md `LC_REPO` path (3x dirname instead of 2x)
- [x] Task 3: Fix `laneconductor.sync.mjs` chokidar watch pattern

## Phase 3: Verify heartbeat + UI ✅ COMPLETE

- [x] Task 1: `make lc-start` equivalent — worker started, no errors
- [x] Task 2: Created test track file → appeared in DB within 2s (`[sync] 001 → in-progress (0%)`)
- [x] Task 3: Changed track to `✅ COMPLETE` → lane flipped to `done`, progress → 100%
- [x] Task 4: Heartbeat interval fired correctly (`[heartbeat] 001`)
- Note: UI start not tested (no browser), but Express API + Vite are independent of sync worker

## ✅ REVIEWED
