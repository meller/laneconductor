# LaneConductor — Project Memory

## Architecture
- One repo: `laneconductor/` — skill (SKILL.md) + heartbeat worker + Vite UI (`ui/`)
- Skill lives at `.claude/skills/laneconductor/SKILL.md` — the real file (not a symlink here)
- Other projects symlink to this directory via `setup scaffold`
- Install path stored in `~/.laneconductorrc` for `setup scaffold` to find
- Real-time updates: Heartbeat worker notifies Express API via `/internal/sync-event`, which broadcasts to React dashboard via WebSockets (`ws`).

## Key Files
- `.claude/skills/laneconductor/SKILL.md` — the Claude skill (all commands)
- `conductor/laneconductor.sync.mjs` — heartbeat worker template + actual worker for this repo
- `conductor/deploy-runner.mjs` — shared `runDeploy(projectRoot, env)`, called by both `bin/lc.mjs`'s `deploy` command and the worker's dispatch handler (track 1085)
- `ui/server/index.mjs` — Express API on :8091
- `ui/src/` — React + Tailwind Kanban board (polls /api every 2s)
- `Makefile` — `make install` / `make ui-install`

## Ports
- Vite UI: **8090**
- Express API: **8091**

## DB Defaults
- host: localhost, port: 5432, name: laneconductor, user: postgres, password: postgres

## Decisions
- WebSocket Push over Polling — upgraded to `ws` for sub-200ms UI updates; kept polling as an exponential-backoff fallback.
- Sync Hardening: Added 250ms per-path debounce and SHA-256 content hashing to eliminate redundant DB writes from duplicate file events.
- Subprocess Guard: Added 5-minute timeout watchdogs to spawned CLI processes with automatic DB flag resets to prevent stuck "running" states.
- Config Hot-Reload: Heartbeat worker watches `.laneconductor.json` and reconnects Postgres pool without requiring a restart.
- Symlink per-project over global `~/.claude/skills/` — Claude Code only reliably loads from local `.claude/skills/`
- ESM throughout (`.mjs`) — no transpilation needed
- No TypeScript — this is a local dev tool, keep it simple
- Claude capacity limits (`429`) require a fallback to a secondary CLI/model (like Gemini) when spawning track implement/review tasks. (Implemented in Track 013)
- When writing literal markdown in `plan.md` (e.g., inside backticks), use `[x]` instead of `[ ]` to prevent the sync worker's regex from counting it as an unfinished task and getting stuck at <100% completion.
- New `planning` lane serves as a staging area for new tracks. Tracks created via UI or SKILL default to `planning`.
- NewTrackModal includes a smart search that suggests appending work to existing non-done tracks instead of creating duplicates.
- Heartbeat worker (sync.mjs) defaults to `planning` status for new tracks if no explicit lane marker is found in the `plan.md` file.
- `make lc-verify` provides a robust way to check heartbeat and sync health. When extracting `PROJECT_ID` from `.laneconductor.json` for use in `curl` URLs, use `process.stdout.write` instead of `console.log` to avoid trailing newlines that cause malformed URL errors in some versions of `curl`.
- Quality Gate Lane: Introduced a dedicated `quality-gate` lane between `review` and `done`. Controlled by a project-level `create_quality_gate` setting. When enabled, `/laneconductor review` transitions PASSing tracks to `quality-gate` instead of `done`. A default `conductor/quality-gate.md` template is provided to formalize secondary verification steps.
- Track Folder Recreation: If track files are missing from disk but the track is found in the database, the `implement` command can autonomously recreate the folder and basic files from the DB context to resume work.
- Improved Verification Script: Enhanced `lc-verify.sh` with millisecond-precision timing for API response checks to strictly enforce the < 500ms requirement. Fixed a discrepancy where `make lc-quality-gate` was pointing to a generic script instead of the project-specific `mock-quality-gate.sh`.
- Worker identity moved off `pid` onto `(project_id, hostname, worker_number)` (track 1084) — `pid` is ephemeral across restarts, `worker_number` (default 1, settable via `--worker-number`) isn't; this is what lets `workers.id` (and everything keyed off it) survive a restart and lets multiple workers run for one project on one host.
- Considered then rejected a dedicated `worker_pins` table for "which workers are mine" (track 1084) — redundant with `workers.user_uid`, already set at registration via auth. Removed same day it was added. Routing to a worker registered under a *different* developer's identity remains unsupported by design — that's cross-machine access, a security question needing its own consent design, not a query change.
- `worker_dispatch` table (track 1085) is a per-worker inbox, separate from the general auto-launch queue — checked every sync tick regardless of `sync-only`/`sync+poll` mode. It's the only way a `sync-only` worker (which never polls the general queue) does anything. Dispatch completion is detected by polling `index.md`'s `**Lane Status**` field (the same one `spawnCli`'s exit handler already writes) rather than adding a second completion callback into that already-complex function.
