# Track 1075: Structured Pino logging for the worker + UI/API

## Phase 1: Foundation — standalone Pinorama service

- [x] `npm install pino pinorama-transport pinorama-studio` in the root package
      (worker's dependencies).
- [x] `npm install pino pinorama-transport` in `ui/` (API's dependencies).
- [x] Added `lc logs [start|stop|status|open]` to `bin/lc.mjs`, mirroring the
      existing `api`/`ui` command shape: PID file + log file at
      `<installPath>/.logs.pid` / `.logs.log`, Pinorama storage at
      `<installPath>/.pinorama.msp`, port 6201 (env-overridable via
      `LC_PINORAMA_PORT`).
- [x] **Bug found and fixed during verification**: initially spawned via
      `spawn('npx', ['pinorama', ...])`, matching the existing `ui start`
      command's `npx vite` pattern. This produced a PID mismatch — the
      spawned `npx` wrapper's PID didn't match the actual listening Fastify
      process, so `lc logs stop` killed the wrapper while the real server
      process survived as an orphan, still holding port 6201 (confirmed via
      `ss -tlnp`). Fixed by invoking `pinorama-studio`'s entry script directly
      via `node <path-to-cli.mjs> --server ...` instead of through `npx` —
      `viewer.pid` now matches the real process, confirmed `stop` frees the
      port immediately.
- [x] Wired `worker start`, `worker restart`, and `api start` to
      best-effort auto-start the log viewer (`spawnSync('node', [__filename,
      'logs', 'start'], { stdio: 'ignore' })`) — wrapped so a viewer failure
      never blocks the worker/API from starting. The log viewer is a
      LaneConductor-wide singleton (not per-project), so it's safe to call
      from every project's worker.

## Phase 2: Worker logger

- [x] Created `conductor/services/logger.mjs`: Pino instance with base field
      `component: "worker"`, `pino.multistream` to (a) `process.stdout`
      (unchanged — still captured into `conductor/.sync.log` by the existing
      spawn redirect) and (b) `pinorama-transport` pointed at
      `http://localhost:6201/pinorama`.
- [x] Migrated 8 `console.*` call sites in `laneconductor.sync.mjs` to
      `logger.info/warn/error`: `pullWorkflow`'s two fetch/logic error paths,
      `pullTracksMetadataFromDB`'s error path, `logSyncSummary` (the
      `[SYNC-SUMMARY]` heartbeat line — also dropped its redundant manual
      ISO-timestamp string since Pino already includes `time`),
      `syncConductorFiles`'s error path, `syncTrack`'s collector-POST-failure
      warning and outer error path, and both `processFileSyncQueue`/
      `checkFileSyncQueue`'s error paths.

## Phase 3: API logger

- [x] Created `ui/server/logger.mjs`: same shape, `component: "api"`.
- [x] Migrated 5 call sites in `ui/server/index.mjs`: `[track-create]`'s DB
      and FS failure paths, `[workflow]`'s success line, `[config]`'s success
      line, `[sync-to-file]`'s success and error lines.

## Phase 4: Verify

- [x] Smoke-tested each logger in isolation first (before wiring into the
      real files) — confirmed via `pinorama`'s own `/pinorama/stats` and
      `/pinorama/search` endpoints that log lines actually land, tagged
      correctly by `component`.
- [x] Full end-to-end: started worker + API + log viewer (via auto-start),
      confirmed `pinorama/stats` showed real traffic (97 docs from a single
      worker reconcile pass), and both `component: "worker"` and
      `component: "api"` entries are present and distinguishable via search.
- [x] Confirmed `conductor/.sync.log` and `ui/.api.log` still receive their
      normal plain-text stdout output, unchanged — no regression for existing
      `tail -f` workflows.
- [x] Confirmed no collision with a managed project's own Pinorama: this
      instance is on port 6201 with its own `.pinorama.msp` file, distinct
      from coachai's separately-running `pinorama --open` session on the
      default port 6200 (both were live simultaneously during testing with no
      conflict).
- [x] Confirmed the fix survives worker restart cycles (`lc worker restart`,
      `lc api stop`/`start` — both exercised repeatedly during Track 1076's
      own verification earlier in this session, which ran concurrently with
      this track's logger changes already in place).

## Phase 5: Document

- [x] Added a "Dev Logging (Worker + API)" section to
      `.claude/skills/laneconductor/SKILL.md` (the canonical skill file
      symlinked into every managed project): how to open the viewer
      (`lc logs [start|stop|status|open]`), the auto-start behavior, the
      port/storage-path convention (6201 / `.pinorama.msp`, never to be
      reused for a managed project's own Pinorama), and how to log from
      worker/API code going forward.

## ✅ COMPLETE
