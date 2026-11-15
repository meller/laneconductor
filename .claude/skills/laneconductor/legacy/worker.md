# Worker, locks, retries and logging (parked daemon-era material)

Only read this when the user asks about the `lc` worker or the heartbeat daemon. Lane work does
not need it.

## `lc` worker commands

- `lc worker run <track>`: **normally what you want.** Runs a worker scoped to that one track in
  the foreground and exits when done. It cannot claim any other queued track, unlike
  `lc worker start --sync-and-work`, which claims *anything* in `queue` and begins autonomous agent
  runs on every other queued track (track 1109).
- `lc worker start [--sync-and-work] [--only-tracks <n,n>] [--once] [--worker-number <N>]`: start the
  heartbeat worker in the background. By default it is MANUAL (`--sync-only`: file<->API sync, plus
  whatever is dispatched explicitly from the UI); `--sync-and-work` makes it AUTOMATIC, polling the
  queue as well. `.laneconductor.json` can set `worker.mode` (`sync+poll` or `sync-only`) and
  `--sync-only` overrides it (track 1042). `--only-tracks` only narrows what it may claim and never
  widens a server-side permission decision; `--once` exits when that scoped work is done.
- **Auto Run gate** (track 10017): independent of `--only-tracks` and the assignee gate, a track's
  `**Auto Run**` marker must be `yes` before the auto-launch loop picks it up from the queue.
  `--only-tracks` naming a track does **not** bypass `auto_run: false`; use `lc worker run <track>`
  for that. The gate is skipped for a track mid-conversation (`waiting_for_reply: true`) and never
  applies to `lc worker run` or explicit dispatch (`worker_dispatch`), which are direct human
  instructions.
- `lc worker stop|restart|status|logs|sync`: stop, restart, check health and PID, stream logs, or
  trigger an immediate fan-out sync across all targets. `lc ui [start|stop]` manages the Vite
  dashboard (the old text asked the user to stop it with Ctrl+C in its terminal).
- Sync targets: `lc add-target --url <url> [--key <key>] [--store-type gcp-secret] [--secret-name <name>]`;
  `lc add-target --type jira --domain <domain> --email <email> --project-key <key> [--token-env <env>]`;
  `lc add-target-mapping --lane <lc_lane> --target "<target_status>"` (for example
  `--lane implement --target "In Progress"`); `lc list-targets` shows active/disabled targets.
- `lc state [--json]`: live instance snapshot and setup gaps (tracks per lane, workers, providers).

## activate / start, deactivate / stop

`activate` (alias `start`): check that `.laneconductor.json` exists (otherwise run `setup collection`
first), then `lc worker start [--sync-and-work]`. Print the PID, the mode, and the dashboard URL
`http://localhost:8090`. `deactivate` (alias `stop`): `lc worker stop`.

## lock / unlock

Branch-mode lane actions run in a git worktree under the primary checkout's `.worktrees/NNN`.
Normally the worker or runner takes the lock for you. By hand:

- `node conductor/lock.mjs NNN` acquires `.conductor/locks/NNN.lock`, creates the worktree, and
  prints JSON: `{ "locked": true, "worktree_path": ..., "lock_file": ..., "user": ..., "machine": ... }`.
  Work inside `worktree_path`.
- `node conductor/unlock.mjs NNN` removes the lock file and the worktree. Always run it when the
  work ends, also after a failure.

## Handling automation failures

A failing lane action increments the track's retry count; once `max_retries` is reached for that
lane (`lanes.<lane>.max_retries`, or `defaults.max_retries`, in `conductor/workflow.json`), its
`lane_action_status` becomes `blocked`. Any human intervention resets the count to 0: a comment in
the track thread, dragging the track to another lane, or "Re-run" in the UI (the system records a
"Moved to [lane]" or "Human comment" marker).

## Dev logging (worker + API, track 1075)

The heartbeat worker (`conductor/laneconductor.sync.mjs`) and the Collector API
(`ui/server/index.mjs`) each have a Pino logger (`conductor/services/logger.mjs`,
`ui/server/logger.mjs`) that writes to stdout (still captured into `conductor/.sync.log` /
`ui/.api.log` by `bin/lc.mjs`) and to a standalone Pinorama log viewer, filterable by `component`
(`worker` or `api`). The viewer is a separate persistent instance rather than a pipe, because both
processes are detached PID-file daemons.

```bash
lc logs start   # standalone Pinorama server on port 6201
lc logs stop
lc logs status
lc logs open    # starts it if needed, opens http://localhost:6201
```
`lc worker start`, `lc worker restart` and `lc api start` already best-effort auto-start it.

**Always use port 6201 (or `LC_PINORAMA_PORT`) and never the default 6200.** The viewer has its own
storage file (`<install-path>/.pinorama.msp`), deliberately different from the default port and
storage a managed project may use for its own Pinorama (coachai's `make local-start` pipes its dev
server into `pinorama --open` on 6200). The two must not collide. In worker/API code, import the
shared `logger` rather than adding `console.*` calls (only the noisiest call sites are migrated so far).
