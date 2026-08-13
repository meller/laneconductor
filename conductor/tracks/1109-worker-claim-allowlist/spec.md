# Spec: Worker claim allowlist — scoped worker invocation (Track 1109)

## Problem Statement

`lc worker start --sync-and-work` starts a daemon that claims **anything**
queued. There is no way to say "run this one track". On a machine with real
queued work that makes starting a worker an all-or-nothing act — it blocked
track 1100's last acceptance criterion, and it is why a CI job cannot safely
run the slow E2E tier.

The gating machinery already exists end to end; it just admits everything in
local mode:

- `GET /api/projects/:id/claimable-tracks` (`ui/server/index.mjs:3770`)
  answers "which queued tracks may THIS worker claim".
- The worker already gates on the result
  (`conductor/laneconductor.sync.mjs:4113`).
- But scoping is identity-derived (`ui/server/index.mjs:3576`:
  `assignee_uid ?? created_by_uid ?? owner_uid`). Local mode has no
  identities, so all three are null and the endpoint takes its
  `// no owner info at all — open claim` branch.

This is **not** an isolation problem — `lc lock` already gives each track its
own git worktree. Isolation is solved; *admission control* is not.

## Requirements

**REQ-1: A claim allowlist independent of identity**
- `--only-tracks <csv>` restricts the worker to exactly those track numbers.
- Must work in **local-fs mode too**, where `claimableSet` is null. That is
  the mode with no identities, so it needs this most.
- Intersects with (never widens) the existing `claimableSet`. A worker must
  never claim something the server said it may not.

**REQ-2: `--once` — exit when there is no more scoped work**
- Lifecycle is *orthogonal* to scoping: a long-lived scoped worker is
  legitimate, so exit-when-done is its own flag rather than implied by
  `--only-tracks`.
- Exits only when nothing is running and no scoped track remains claimable —
  never mid-track.

**REQ-3: `lc worker run <track>` front door**
- Thin wrapper over `start --sync-and-work --only-tracks <n> --once`, in the
  foreground. One execution path, no second implementation.

**REQ-4: The scope is observable**
- Logged at startup, so a deliberately scoped worker is not mistaken for a
  broken one that "won't pick anything up".
- **Descoped 2026-08-13**: reporting the scope to the collector (so the UI
  itself could show a worker as scoped) is dropped from this track's
  requirements. It needs a `workers` schema column plus UI work, which is
  disproportionate to what this track is actually for — unblocking
  `lc worker run` as a CLI/CI tool, not building UI affordance for it. The
  startup log is sufficient for that purpose: anyone running a scoped worker
  is, by construction, already looking at its own terminal output.
  Collector-side reporting is real, useful, follow-up work — it just isn't
  *this* track's job. If picked up later, it belongs with track 1084's
  worker-lifecycle UI work (Phase 6), which already owns this class of gap.

**REQ-5: Session continuity is preserved across scoped runs**
- A scoped worker must reuse a **stable** identity (`hostname` +
  `worker_number`), or it gets a fresh `worker_id`, misses its
  `track_sessions` row, and silently cold-rebuilds context every run.

## Acceptance Criteria

Observable outcomes only — a criterion satisfiable by a stub does not count.

- [x] A worker started with `--only-tracks N` claims track N **and provably
      leaves an unlisted queued track alone** (the negative is the point).
      Verified against a real two-track local-fs fixture with a control run.
- [x] The allowlist works in local-fs mode, where `claimableSet` is null.
      Same fixture — local-fs was the test mode used.
- [x] The allowlist cannot widen server-side permission: a track excluded by
      `claimableSet` stays unclaimable even if named in `--only-tracks`.
      Unit-tested (TC-7).
- [x] `--once` exits after the scoped work is done, and does **not** exit
      while a track is still running. Exited 0 in ~20s against the fixture,
      not the 60s timeout used to bound the test.
- [x] `lc worker run <track>` runs that track to completion in the
      foreground and exits, without touching other queued tracks. Exited 0
      in ~21s, only the targeted track claimed.
- [x] The effective claim scope appears in the worker's startup log.
      (Collector-side reporting removed from scope — see REQ-4.)
- [x] Running the same scoped track twice yields `FRESH_SESSION: false` on
      the second run — proving session reuse survived the exit rather than
      silently cold-starting. Verified in two parts rather than one live
      run (see plan.md): the DB-level persistence chain, live against the
      real collector; and the exact literal `-p` argument a real `claude`
      invocation receives, computed from that session — both confirmed
      correct. No live `claude` process was actually spawned (real API
      cost); that final hop is Anthropic's CLI honoring its own `-p` input,
      not something this track controls.

## Design Decisions

Settled here rather than left to the implementation:

1. **`--once` is a separate flag, not implied by `--only-tracks`.** Scoping
   and lifecycle are orthogonal; a persistent worker scoped to two tracks is
   a legitimate configuration.
2. **`lc worker run <track>` is a wrapper**, expanding to
   `--sync-and-work --only-tracks <track> --once` in the foreground.
3. **The unscoped default is unchanged.** Making bare `--sync-and-work`
   require `--all` is plausibly right but is a breaking change to a
   documented flag — out of scope (see Non-Goals).
4. **`--only-tracks` forces poll mode for that run.** It is meaningless
   under `sync-only` (which never polls the queue), so it overrides
   `worker.mode` from `.laneconductor.json` rather than silently doing
   nothing. `--sync-only` passed explicitly alongside it is a user error and
   is rejected.
5. **Allowlist and `claimableSet` intersect.** The allowlist narrows only.

## Non-Goals

- Changing the default behaviour of an unscoped `--sync-and-work`.
- `assigned_worker_id` / explicit track pinning — the more general fix, needs
  a migration, its own track.
- Continuity-first routing — that is [1084](../1084-worker-identity-and-assignment/index.md)
  Phase 7, and it edits the same `claimable-tracks` function. Land one, then
  rebase the other; precedence (allowlist overrides continuity) must be
  tested there.
- Session persistence in local-fs mode (`resolveTrackSession` returns null
  there, so every local-fs run cold-starts regardless of this track).
- **Reporting the claim scope to the collector for UI display** (descoped
  2026-08-13 — see REQ-4). Belongs with [1084](../1084-worker-identity-and-assignment/index.md)
  Phase 6, not here.
