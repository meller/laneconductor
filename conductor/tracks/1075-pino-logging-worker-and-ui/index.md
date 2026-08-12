# Track 1075: Structured Pino logging for the worker + UI/API, with a live Pinorama viewer

**Lane**: quality-gate
**Lane Status**: running
**Progress**: 100%
**Phase**: Implementation complete
**Type**: dev
**Summary**: Standalone `pinorama --server` on port 6201 + `pinorama-transport` wired into both the worker and API's Pino loggers, tagged by `component`. New `lc logs [start|stop|status|open]` command, auto-launched from `worker start`/`restart`/`api start`. **Phase 6**: the new logging surfaced 4 real crashes already in `ui/.api.log` — all from unhandled `'error'` events (pg pool idle-client drops, `server.listen()` EADDRINUSE, and `ws`'s `WebSocketServer` re-emitting the http server's `'error'` onto itself). Fixed all three sources; verified live by reproducing both crash scenarios against the running dev API and confirming it now survives and logs cleanly instead of crashing.

## Problem

Both of LaneConductor's own long-running Node processes log via scattered
`console.log`/`console.warn`/`console.error` calls, captured only by shell-redirecting
`stdio: ['ignore', logFd, logFd]` into `conductor/.sync.log` and `ui/.api.log` (see
`bin/lc.mjs`'s `start`/`restart`/`api start` commands). No structure, no search, no live
tailing UI — debugging either process today means `tail -f` on a plain-text file, which we
were doing by hand for Track 1074's own investigation (the collector-down + `restart`-crash
bug in `coachai`).

coachai already solved this exact problem for its own Node backend in Track 070: Pino for
structured JSON logging, `pino-roll` for rotated/retained file output, and Pinorama
(`node app.js | pinorama --open`) for a live web viewer at `localhost:6200`.

## Why this isn't a direct copy-paste

coachai's Track 070 wires Pinorama via the documented pipe pattern
(`node server/index.mjs | npx pinorama --open`) because its dev server is a single
**foreground** process. LaneConductor's worker and API are both **detached background
daemons** (`spawn(..., detached: true)`, PID-file tracked, started/stopped independently via
`lc worker start/stop` and `lc api start/stop`) — there's no single foreground command to
pipe, and two separate detached processes can't both pipe into one shared stdin after the
fact.

**Also matters for this repo specifically**: LaneConductor manages many *other* projects,
each of which might run their own Pinorama instance (like coachai's, on the default port
6200 with the default `os.tmpdir()/pinorama.msp` store). LaneConductor's own Pinorama must
be fully independent — different port, different storage path — or the two collide (see
the pinorama-mechanics discussion in this session: it's a dumb stdin/HTTP sink with no
per-project awareness of its own).

**Planned approach** (see spec.md for full reasoning): a standalone, persistently-running
`pinorama --server` instance (own port, own `--server-db-path`), fed by both the worker and
the API via `pinorama-transport` (Pino's HTTP-shipping transport target for a running
`pinorama-server`) — rather than the pipe pattern, since both sources are background
daemons. Each log line tagged with `component: "worker"` or `component: "api"` for
filtering within the one Studio view.
