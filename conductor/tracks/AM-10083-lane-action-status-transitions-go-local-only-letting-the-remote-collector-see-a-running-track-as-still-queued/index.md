# Track AM-10083: Lane action status transitions go local-only, letting the remote collector see a running track as still queued

**Lane**: done
**Merge Mode**: direct
**Lane Status**: queue
**Progress**: 100%
**Last Run**: claude/claude-sonnet-5 (primary)
**Phase**: Implementation complete — cloud deploy and live dashboard verification deferred to a human (see plan.md Tasks 2.5/6.6)
**Type**: dev
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Summary**: The fast, in-process `lane_action_status: 'running'` write when a lane action starts is sent only to the primary (local) collector — the remote collector only learns about it via the slower,…

## Problem

Found live 2026-09-08, prompted by looking at app.laneconductor.com directly
while a local `implement` was genuinely running for track 10080.

`conductor/laneconductor.sync.mjs`'s dispatch-processing loop resolves its
target with `const { url, token } = primaryCollector();` (line ~8794) —
`primaryCollector()` always returns `getCollectors()[0]`, the first entry in
`.laneconductor.json`'s `collectors` array, which for this project is the
local one (`http://127.0.0.1:8091`). Every `patch(url, token,
/track/${trackNumber}/action, ...)` call inside that loop — including the
one that flips `lane_action_status` to `'running'` the instant a lane action
actually starts (line ~9524) — goes to local only.

The remote collector (`https://api-pu7bcq73zq-uc.a.run.app`, configured as
the second entry) only finds out a track is running via a completely
different path: `syncTrack()` reads the track's `index.md` (which the
dispatch loop does correctly update — `writeFileSync(indexPath,
updateHeader(content, 'Lane Status', 'running'), ...)` right before the
local-only PATCH) and pushes the FULL content via `postToCollectors()`,
which does fan out to every collector. But that only fires on a file-watch
event for that specific file, whenever the watcher gets around to it — there
is no guarantee of it happening promptly, and no guarantee it fires at all
if the watcher is backlogged (this session alone touched dozens of tracks'
files in rapid succession while investigating unrelated things).

**Live evidence gathered 2026-09-08**: app.laneconductor.com showed:
- Track 10080 (implement, 65%+ and genuinely running locally, confirmed via
  a real PID) displayed a stale mid-session comment under a "Queued for
  automation" badge — no indication it was actually running.
- Tracks 1097, 1090, and 1080 all showing under a "RUNNING" section with a
  self-reported "stale 19s" tag, despite their own most recent dispatch
  text explicitly saying they'd already reset themselves back to `queue`
  ("I reset the stuck Lane Status: running back to queue...").
- The project-level "No worker for this project" banner (root-caused
  separately and fixed in AM's same investigation — see commit `953f79c8`,
  a missing rowCount check in `PATCH /worker/heartbeat` on the cloud
  function) — a related but distinct symptom of the same "local and remote
  can silently disagree" theme.

## Why this is a correctness risk, not just a display bug

Flagged directly by the user: **a worker polling primarily against the
remote collector — a genuinely different machine, or a worktree-spawned
process (see track TU-10064's own prior finding that worktree-spawned
workers can register against the real remote collector) — could see this
track as still `lane_action_status: queue` and claim it, launching a SECOND
concurrent `implement` session on the same track while the first one is
still genuinely running.** This is a real double-dispatch race, not a
cosmetic staleness issue, and it's the same failure shape `conductor/.conductor/locks/<track>.lock`
and the global main-mode lock exist to prevent for LOCAL concurrent
claims — but those locks are local files, invisible to a worker whose
"local" is a different machine entirely.

## Scope

1. **Send the fast running/status-only transition to every collector, not
   just primary** — either call `patchCollectors()` (the existing
   all-collector fan-out `syncTrack()` already uses) instead of the bare
   `patch(url, token, ...)` at the dispatch loop's status-transition sites,
   or confirm there's a reason those specific calls were scoped to primary
   only and address that reason directly instead.
2. **Decide whether claim-queue checks should distrust a track whose
   remote-vs-local state can't be freshly cross-checked** — a defense in
   depth layer for exactly the double-dispatch scenario above, independent
   of (1) actually landing correctly everywhere.
3. **Investigate whether `syncTrack()`'s file-watch trigger has a real
   latency/backlog problem** under sessions that touch many tracks' files
   in quick succession (this session's own conditions when the staleness
   was observed) — if the watcher is simply slow/backlogged rather than
   architecturally local-only, that's a different, possibly simpler fix
   than (1).
4. **Regression test**: dispatch an action locally, assert the resulting
   `lane_action_status: running` transition reaches every configured
   collector (not just primary) within the same tick — mirroring the shape
   of the live bug found, not just unit-testing `patchCollectors()` in
   isolation.

## Related
[TU-10064](../TU-10064-remote-collector-sync-silently-fails-env-token-unreachable-from-worktrees-and-failures-are-invisible/index.md) — same "local and remote can silently disagree" family, different specific cause (auth token unreachable from worktree cwd, since fixed) and different endpoint.
Fixed alongside this investigation, same session: `PATCH /worker/heartbeat` on the cloud function (`cloud/functions/index.js`) had no rowCount check and silently no-op'd forever once a worker's registration row was missing — commit `953f79c8`.
**Auto Run**: yes
