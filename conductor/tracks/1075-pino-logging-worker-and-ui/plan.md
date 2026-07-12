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

## Phase 6: API crash resilience (found via Pinorama investigation)

**Problem**: the new logging surfaced 4 crashes already sitting in `ui/.api.log`
that pino hadn't caught since they predate the pool/listen code paths being
migrated — all from the same root cause: an EventEmitter's `'error'` event
with no listener, which Node treats as an uncaught exception and kills the
whole process. No supervisor auto-restarts it, so each crash required a
manual `make api-start` (this is why the dashboard needed restarting the
morning of 2026-07-11).

- [x] `pool.on('error', ...)` on the pg `Pool` in `ui/server/index.mjs` —
      3x in the log, Postgres administratively terminating an idle pooled
      client (`FATAL 57P01 terminating connection due to administrator
      command`) crashed the entire API instead of just that connection.
      Logged via `logger.error` (pino/Pinorama) rather than `console`.
- [x] `server.on('error', ...)` on the http server, ahead of
      `server.listen(PORT, ...)` — 1x in the log, `EADDRINUSE` (port already
      held by another instance) crashed with a raw stack trace instead of
      exiting cleanly. Now logs a clear message via `logger.error` and exits
      with code 1.
- [x] **Second unhandled-'error' source found during verification**:
      `ws`'s `WebSocketServer` (constructed with `{ server }` in
      `wsBroadcast.mjs`) re-emits the underlying http server's `'error'`
      event onto itself. Since that re-emission has no listener, it throws
      *before* the `server.on('error', ...)` handler above ever runs
      (registered later = called later; the re-emit's own throw happens
      inside the first, ws-internal listener). Confirmed by reproducing the
      EADDRINUSE crash live — the `server.on('error')` handler alone did not
      stop the crash. Fixed by adding `wss.on('error', ...)` directly in
      `wsBroadcast.mjs`, at the actual source of the re-emission.
- [x] Verified both fixes live against the running dev API (PID 1298660):
      `pg_terminate_backend()` on one of the pool's idle connections —
      process survived, pino line `[db] idle client error (connection
      dropped, pool recovers)` landed correctly. Then started a second
      `node server/index.mjs` against the already-bound port — logged
      `[ws] WebSocketServer error` + `[LaneConductor API] Port 8091 already
      in use`, exited 1 cleanly, original instance (PID 1298660) confirmed
      still healthy via `/api/health` afterward.

## ✅ COMPLETE
