# Track 10019: Shared infra processes must always run from the primary checkout, never a worktree

**Lane**: backlog
**Lane Status**: queue
**Progress**: 0%
**Type**: dev
**Waiting for reply**: no
**Summary**: Systematic audit of every process that acts as shared, live LaneConductor infrastructure (sync workers, UI dev server, API server, and anything else that resolves paths from cwd), to guarantee none of them can ever accidentally run from a linked worktree's own divergent copy of the code. Two confirmed live incidents already fixed piecemeal (F16, F17 in track 1102) — this track is the systematic follow-through instead of waiting for each remaining instance to bite.

## Problem

This repo dogfoods itself: the files that implement LaneConductor's own
worker orchestration, dispatch, and UI (`conductor/laneconductor.sync.mjs`,
`bin/lc.mjs`, `ui/server/index.mjs`, `ui/src/components/*`) are
simultaneously the infrastructure running the system AND the product
surface that in-flight tracks are actively editing, each inside its own
git worktree. That's expected and fine — a worktree is *supposed* to
diverge from `main` while its track is in progress.

The actual problem: nothing structurally prevents a long-running,
system-wide process (a sync worker, a dev server) from being started
*from inside* one of those worktrees instead of the primary checkout —
and when that happens, everyone using the "live system" is silently
served that worktree's own, possibly very stale or half-finished code,
indistinguishable from the real thing.

Confirmed live so far (both in [1102](../1102-e2e-session-findings/index.md)):
- **F16**: the worker-identity lock computed its path from `process.cwd()`
  — two processes meant to hold the SAME identity's lock could compute
  different paths and never collide, if one was spawned from a worktree.
- **F17**: `lc worker start`/`restart`/`stop`/`worker run`/`worker status`
  all resolved their target script and pidfile from `findProjectRoot(cwd)`
  — running any of them from inside a linked worktree spawned/looked for
  a worker pointed at that worktree's own stale copy of the sync script.
  Live-reproduced: a worker spawned this way recreated the exact
  nested-worktree bug from hours earlier, using code that predated the
  fix entirely.

Both were found by accident, hours apart, from real symptoms (recurring
detached worktrees, "can't delete from the UI"). The open question this
track exists to answer: **what else is exposed to the same class of bug,
and can it be closed off structurally instead of one incident at a time?**

## Scope (candidates to audit — confirm each is either safe or needs the same fix)

- UI dev server (`ui-start` / `make ui-start` / `vite`) — currently
  observed running from primary correctly, but nothing prevents someone
  running `cd .worktrees/X && npm run dev` and serving that worktree's
  frontend on the project's "expected" port instead.
- API server (`api-start` / `ui/server/index.mjs`) — same question.
- Any other `spawn`/`execSync` call site in `bin/lc.mjs` or
  `laneconductor.sync.mjs` that builds a path from `process.cwd()` rather
  than a resolved primary root, beyond the ones F16/F17 already covered.
- Makefile targets (`lc-*`) — do any of them assume `pwd` is the primary
  checkout without checking?
- Whether `resolvePrimaryRepoRoot()` itself needs a cheap cache (it shells
  out to git on every call — fine for occasional CLI commands, worth
  checking it's not called somewhere hot/frequent).

## Non-goals

- NOT trying to make every worktree's copy of infra code identical to
  `main` — that's the opposite of what a worktree is for. A track's
  worktree is *supposed* to diverge until it merges.
- NOT a policy/process change (e.g. limiting how many infra-touching
  tracks can run concurrently) — that reduces the odds of collision but
  doesn't fix the structural gap; this track is about making the gap
  impossible to hit regardless of how many tracks are in flight.

## Related tracks
- [1102](../1102-e2e-session-findings/index.md) — F16 and F17, the two confirmed live incidents motivating this track
- [1114](../1114-worktrees-panel-deep-link-autopilot-cleanup/index.md) — the Worktrees panel work these incidents surfaced during

## Phases
- [ ] Phase 1: Audit every candidate spawn/serve/path-resolution site listed above; for each, confirm whether it's vulnerable and whether it needs the `resolvePrimaryRepoRoot()` fix pattern
- [ ] Phase 2: Fix whatever the audit finds, one targeted change per site (matching F16/F17's pattern — narrow, not a global `findProjectRoot()` rewrite)
- [ ] Phase 3: Consider a lightweight guard/warning (e.g. a startup log line noting "running from worktree, not primary" for any long-running process) as defense-in-depth for whatever this audit doesn't structurally rule out
