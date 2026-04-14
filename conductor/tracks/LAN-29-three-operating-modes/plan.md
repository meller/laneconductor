# Track 1017: Three Operating Modes — Plan

## Phase 1: Document modes in product.md, landing page, and setup flow

**Problem**: Users don't know LaneConductor has three modes or how to configure them.
**Solution**: Add a clear "Three Operating Modes" section everywhere a user learns about LaneConductor.

- [x] Task 1: Update `SKILL.md` — `setup collection` now asks operating mode first (before DB/collector config)
  - Mode selection prompt: `[1] local-fs  [2] local-api  [3] remote-api`
  - Three `.laneconductor.json` templates (one per mode)
  - DB and UPSERT steps marked as local-api only
  - local-api description includes `localhost:8090` Vite UI
- [x] Task 2: Update `SKILL.md` — `setup scaffold` now also copies `conductor/workflow.json`
- [x] Task 3: Add "Three Operating Modes" section to `conductor/product.md`
  - Mode table, config snippets, when-to-use guidance
- [x] Task 4: No static landing page exists — skipped

**Impact**: Users understand which mode to use and how to configure it.

---

## Phase 1.5: Fix workflow config plumbing (local-api / remote-api loose ends)

**Problem**: `workflow.md` was used as a config+docs hybrid. JSON block was removed but the plumbing still referenced it. The workflow sync between worker ↔ server was broken.

**Solution**: `workflow.json` is the single source of truth. Remove `workflow.md`. Fix all four loose ends.

- [x] Task 1: Delete `conductor/workflow.md` (UI already provides human visualization)
- [x] Task 2: `syncConductorFiles` — send `workflow_json` (content of `workflow.json`) instead of `workflow` (workflow.md content)
- [x] Task 3: `pullWorkflow` — write server's JSON response directly to `conductor/workflow.json` (not into a markdown block)
- [x] Task 4: `checkFileSyncQueue` — use `if (isLocalFs) return` guard (consistent with other functions)
- [x] Task 5: Remove `conductor/workflow.md` from chokidar watch list
- [x] Task 6: Server `GET /projects/:id/workflow` (both collector + UI API) — read `conductor_files.workflow_json`, fallback to disk `workflow.json`
- [x] Task 7: Server `POST /api/projects/:id/workflow` — store as `conductor_files.workflow_json`, write to disk `workflow.json`

**Impact**: Workflow config roundtrip works correctly in all API modes. No more dead markdown-block parsing.

---

## Phase 2: Polish local-fs mode + migrate E2E to node:test

**Problem**: In local-fs mode, `spawnCli` creates git locks and worktrees even though:
- There's no remote to push locks to
- The worktree paths end up in the laneconductor repo's `.git/worktrees/`, not the test dir
- This produces spurious errors in test output and CI
- `local-fs-e2e.test.mjs` uses a hand-rolled assert harness — should use `node:test` (built-in, consistent with tech-stack.md)

**Solution**: Skip git lock/worktree in local-fs mode. Migrate test to `node:test`.

- [x] Task 0: Update `tech-stack.md` and `quality-gate.md` with correct test technology per layer
- [x] Task 1: Migrate `local-fs-e2e.test.mjs` to `node:test` (replace custom assert/poll with `node:test` describe/it + built-in assert)
- [x] Task 2: In `spawnCli`, add `if (!isLocalFs)` guard around `checkAndClaimGitLock` and `createWorktree`
- [x] Task 3: In `spawnCli`, add `if (!isLocalFs)` guard around lock/worktree cleanup in exit handler
- [x] Task 4: `cwd` already falls back to `process.cwd()` when `worktreePath` is null — no change needed
- [x] Task 5: `node --test conductor/tests/local-fs-e2e.test.mjs` → 4/4 pass, zero git errors

**Impact**: Clean output in local-fs mode. Tests use the right technology. Runnable anywhere with zero deps.

---

## Phase 3: Tests for Mode 2 (local-api with mock collector)

**Problem**: No automated tests for local-api mode.
**Solution**: Create a lightweight mock HTTP server that mimics the collector API, then run the worker against it.

- [x] Task 1: Create `conductor/tests/mock-collector.mjs` — minimal Node http server (zero deps) with:
  - `POST /track` — upsert track from chokidar file sync
  - `POST /tracks/claim-queue` — return queued tracks from in-memory store
  - `PATCH /track/:num/action` — update action status
  - `GET /track/:num/retry-count` — return count (incremented via comment body matching)
  - `PATCH /track/:num/block` — set failure status on max retries
  - `POST /_reset` — clear state between tests
  - `GET /_state` — inspect in-memory state from test assertions
  - Added `LC_SKIP_GIT_LOCK=1` env var to worker (skips git lock/worktree in tests)
- [x] Task 2: Create `conductor/tests/local-api-e2e.test.mjs`
  - Start mock collector on random port
  - Write `.laneconductor.json` pointing at it
  - Run worker with LC_MOCK_CLI + LC_SKIP_GIT_LOCK
  - Assert track transitions via mock collector's `/_state` endpoint
- [x] Task 3: Verify parallelism limit is respected (same as Mode 1 tests)

---

## Phase 4: Tests for Mode 3 (remote-api)

**Problem**: Mode 3 is identical to Mode 2 from the worker's perspective — just a different URL.
**Solution**: Reuse Mode 2 test infrastructure with explicit `config.mode: "remote-api"`.

- [x] Task 1: In `local-api-e2e.test.mjs`, second suite uses `config.mode: "remote-api"` with 127.0.0.1 URL — verifies explicit mode config is respected
- [x] Task 2: Verified mode detection correctly identifies remote-api (printed in worker logs)

---

## Phase 5: Update SKILL.md quick reference

- [x] Task 1: Add "Mode configuration" section to SKILL.md
  - How to set `config.mode` in `.laneconductor.json`
  - Auto-detection rules
  - When to use each mode

---

## Success Criteria

✅ `local-fs-e2e.test.mjs` — 6/6 passing, zero git errors
✅ `local-api-e2e.test.mjs` — transitions and parallelism verified against mock collector
✅ product.md and SKILL.md document all 3 modes clearly
✅ No infrastructure needed for Mode 1 tests (runs in any CI)
## ✅ REVIEWED
