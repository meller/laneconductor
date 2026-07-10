# Spec: Structured Pino logging for the worker + UI/API (Track 1075)

## Problem Statement

`conductor/laneconductor.sync.mjs` (the heartbeat worker) and `ui/server/index.mjs` (the
Express API backing the Kanban dashboard) both log via raw `console.log`/`console.warn`/
`console.error`, redirected into plain-text append files (`conductor/.sync.log`,
`ui/.api.log`) by `bin/lc.mjs` at spawn time. No structure (can't filter/search by field),
no rotation/retention policy, no live viewer — just `tail -f` on a growing text file (the
worker's log is already 1.5M+ lines in this dev environment).

## Prior Art: coachai Track 070

coachai solved the identical problem for its own Node backend: Pino (structured JSON) +
`pino-roll` (rotation, 3-day retention) + Pinorama (`node app.js | pinorama --open`, live
web viewer at `localhost:6200`). Reuse that stack's *libraries* here; the *wiring* has to
differ because of an architectural difference — see below.

## Why the Wiring Differs From coachai

coachai's Pinorama integration works because `make local-start` runs the dev server as a
single **foreground** process inside one `concurrently` slot — trivially pipeable
(`node server/index.mjs | npx pinorama --open`).

LaneConductor's worker and API are **detached background daemons**:
- `lc worker start` spawns `laneconductor.sync.mjs` detached, PID tracked in
  `conductor/.sync.pid`, stdout/stderr redirected to `conductor/.sync.log` via `openSync`.
- `lc api start` spawns `ui/server/index.mjs` detached the same way, into `ui/.api.log`.

Neither is a foreground pipe target, and there are **two** independent sources that need to
land in **one** viewer — you can't pipe two unrelated detached processes into a single
`pinorama`'s stdin after the fact.

**Also**: LaneConductor manages many *other* projects (coachai among them), each of which
may run its own Pinorama on the default port (6200) and default storage path
(`os.tmpdir()/pinorama.msp`, confirmed by reading `pinorama-studio`'s CLI source —
it's a hardcoded default, not project-aware). LaneConductor's own Pinorama instance must use
a **different port and a different `--server-db-path`**, or the two collide.

## Decision: standalone `pinorama --server` + `pinorama-transport`

Instead of the pipe pattern, run Pinorama once as a standalone, persistently-running
service in `--server` mode (confirmed via `pinorama-studio`'s CLI source: `-s/--server`
flag exposes an HTTP bulk-ingest endpoint, `POST <host>:<port><server-prefix>/bulk`), on a
dedicated port (**6201**, avoiding coachai's 6200) with a dedicated
`--server-db-path` (e.g. `~/.laneconductor/pinorama.msp`, not the shared tmpdir default).

Both the worker and the API then use **`pinorama-transport`** (Pino transport target
package, ships log lines to a running `pinorama-server`'s HTTP ingest endpoint) as one
target in a `pino.multistream`, alongside the existing plain-stdout target (preserving
today's `.sync.log`/`.api.log` file-tailing behavior — no regression for anyone still using
`tail -f`).

Each logger instance sets a base field `component: "worker"` or `component: "api"` so both
processes' logs land in the **same** Pinorama Studio session and can be filtered by
component, by track number, etc.

**Note on Track 070's precedent**: Track 070 explicitly avoided building against
Pinorama's HTTP bulk-ingest route because hitting it directly (raw `POST /bulk`) wasn't
documented/stable from application code. That concern doesn't apply here — `pinorama-transport`
is the first-party, documented Pino transport package built specifically to talk to that
endpoint; it just wasn't the right fit for coachai's single-foreground-process case, where
the plain pipe was simpler. For two background daemons, `pinorama-transport` is the more
natural mechanism, not a workaround.

## Requirements

- REQ-1: `conductor/laneconductor.sync.mjs` gets a Pino logger (structured JSON), replacing
  `console.*` at least at the noisiest call sites as a proof of concept (not a full
  migration — matches Track 070's scope decision in coachai).
- REQ-2: `ui/server/index.mjs` gets its own Pino logger, same proof-of-concept scope.
- REQ-3: Both loggers fan out to (a) stdout — preserving today's `.sync.log`/`.api.log`
  file-based tailing unchanged — and (b) `pinorama-transport`, shipping to one shared
  standalone `pinorama --server` instance.
- REQ-4: The standalone Pinorama instance runs on a port and storage path that cannot
  collide with any managed project's own Pinorama (own port ≠ 6200, own
  `--server-db-path` ≠ the shared tmpdir default).
- REQ-5: Lifecycle-managed the same way `lc worker`/`lc api`/`lc ui` already are — a new
  `lc logs [start|stop|open|status]` command (or folded into `lc worker start`/`lc api
  start` themselves — decide during implementation which reads more naturally given the
  existing command surface) that starts/stops the standalone Pinorama process, tracked via
  its own PID file, matching the existing pattern in `bin/lc.mjs`.
- REQ-6: Each log line includes a `component` field (`"worker"` | `"api"`) so both
  processes' logs are distinguishable within the single shared Studio view.
- REQ-7: Dev-only tool — no production log-aggregation, no new always-on cost beyond what a
  developer opts into locally (mirrors Track 070's REQ-6 in coachai).
- REQ-8: Document in `SKILL.md` (or wherever LaneConductor's own dev docs live): how to open
  the viewer, how to log from worker/API code, and the port/storage-path convention so a
  future contributor doesn't accidentally collide with a managed project's own Pinorama.

## Non-Requirements (explicitly out of scope)

- Migrating every existing `console.*` call site in either file in one pass.
- Any change to how managed *projects'* own dev-server logging works (that's each
  project's own concern, like coachai's Track 070) — this track is only about
  LaneConductor's own two processes.
- Rotation/retention policy for the Pinorama-side store itself (matches Track 070's
  finding: Pinorama's own storage isn't the durable/retained copy — if file-based retention
  is wanted later, add `pino-roll` as a third multistream target the same way Track 070 did;
  not required for this track's acceptance criteria since `.sync.log`/`.api.log` already
  exist as the durable copy, just not rotated — rotation/retention polish is a candidate
  follow-up track, not blocking here).

## Acceptance Criteria

- [x] `conductor/services/logger.mjs` exports a configured Pino instance for the worker,
      multistreaming to stdout + `pinorama-transport`.
- [x] `ui/server/logger.mjs` exports the API's own configured Pino instance, same
      multistream shape, tagged `component: "api"`.
- [x] A standalone `pinorama --server` instance can be started/stopped via `lc logs
      [start|stop|status|open]`, on port 6201 with its own `.pinorama.msp` storage file —
      confirmed no collision while running simultaneously with coachai's own Pinorama on the
      default port 6200.
- [x] With the worker, the API, and the standalone Pinorama instance all running, both
      processes' logs are confirmed present (via `/pinorama/stats` and `/pinorama/search`)
      and filterable by `component`.
- [x] Existing `.sync.log`/`.api.log` file-based logging confirmed unchanged.
- [x] Migrated 8 call sites in `laneconductor.sync.mjs` (pullWorkflow ×2, pullTracksMetadataFromDB,
      logSyncSummary, syncConductorFiles, syncTrack ×2, file-sync-queue error paths) and 5 in
      `ui/server/index.mjs` (`[track-create]` ×2, `[workflow]`, `[config]`, `[sync-to-file]` ×2).
- [x] `.claude/skills/laneconductor/SKILL.md` documents how to open the viewer, the auto-start
      behavior, the port/storage convention, and how to log from code.
- [x] No regression in existing behavior: exercised `lc worker start/stop/restart` and
      `lc api start/stop` repeatedly during both this track's and Track 1076's verification.
