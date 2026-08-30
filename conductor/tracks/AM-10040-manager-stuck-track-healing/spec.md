# Spec: Manager Stuck-Track Healing

## Problem Statement

Stuck-track *detection* exists and works; stuck-track *repair* does not. Tracks wedge in states
no automated component can escape, and nothing escalates them to a human either — they just spin
invisibly. Three distinct failure modes were confirmed live on 2026-08-30 (tracks 10036 and
10040 themselves), all documented below.

The manager worker (track 1091) is the natural owner: it's the machine-level singleton with
cross-project scope. Today its *entire* self-healing repertoire is one function —
`reapOrphanedWorkerProcesses` (`laneconductor.sync.mjs`, track 1091 Phase 7), which kills
**unregistered** `laneconductor.sync.mjs` processes older than 30 minutes. Nothing about stuck
tracks, phantom markers, duplicate folders, or dirty checkouts exists in its code.

## Finding 1 — Permanent workspace-guard blocks never escalate

`workspace: main` lane actions check the primary checkout is clean before spawning. On a
*permanently* dirty checkout the guard blocks every cycle forever:

1. `resetStuckActions` (every worker, every 2 min → `POST /tracks/reset-stuck-actions`) resets a
   stale `running` row to `queue` + `lane_action_result: stuck_timeout`. Detection works.
2. `Auto Run: yes` → worker re-claims → `running` → guard blocks before spawn
   (`laneconductor.sync.mjs` ~4380) → reverts to `queue` → appends a ⚠️ comment.
3. Repeat forever. **Track 10036 accumulated 191 such comments** over a `ui/node_modules`
   symlink that was committed to git before being ignored, so `git status` reported
   `D ui/node_modules` permanently. No human-visible failure state was ever reached.

Why it can't self-escalate:
- Retry counting lives in the spawned process's **exit handler** (~line 4879). The guard throws
  **before** any spawn, so no failure is counted and `max_retries_reached` can never fire.
- The guard tags its error `err.workspaceGuardBlocked = true` — **that flag is never read
  anywhere in the codebase**. Dead code.

## Finding 2 — Quarantined duplicate folders embalm phantom `running` markers

`quarantineStaleFolder` (`laneconductor.sync.mjs:1366`) renames an ambiguous duplicate track
folder to `_duplicate-<name>` so folder *resolution* can never match it again. It does **not**
delete the folder or clear its status markers.

But the lane concurrency counter (`laneconductor.sync.mjs:5541-5560`) scans **every** directory
under `conductor/tracks/` — `_duplicate-*` included — and counts any `**Lane Status**: running`
it finds toward that lane's `parallel_limit`. Quarantining a folder mid-"run" therefore
**permanently** burns a parallel-limit slot.

Confirmed live: `_duplicate-10039-cloud-workers-claude-cloud/` (`implement: running`) and
`_duplicate-10038-...` (`review: running`) held phantom slots while the DB had **zero** implement
tracks running and the worker had no agent child processes. Result:
`[local-fs] Lane "implement" at limit 2 (Running: 3, Claimed: 0). Skipping 10036-...` — track
10036's implement could never be claimed.

Note the counter reads `Math.max(fromFiles, internalRunning)`, so a filesystem phantom always
wins over correct in-process state.

## Finding 3 — Long-lived workers manufacture the duplicates (root cause chain)

The duplicates in Finding 2 come from track 10036's own bug: `tracksMetadata` is cached once per
worker process and never invalidated, so a worker older than a track can't resolve its folder,
and the implement skill scaffolds a duplicate legacy `NNN-slug` folder beside the real
`INITIALS-NNN-slug` one. The manager process (alive since 2026-08-27) and worker-2 (2026-08-28)
both predate every 100xx track from that week and were actively producing duplicates.

Those untracked duplicate folders then dirty the primary checkout, which re-triggers Finding 1
for *other* tracks — 10040's own plan run was blocked by
`conductor/tracks/10036-.../, conductor/tracks/10039-.../`. The three findings compound.

Also worth noting: `reapOrphanedWorkerProcesses` did **not** catch a real zombie worker found the
same day (PID 1736711, ~17% CPU for 2 days against a deleted cwd) because that process had
registered itself in the workers table at startup. Registered-but-useless is invisible to the
sweep's orphan definition.

## Requirements

- REQ-1: Count consecutive workspace-guard blocks per track (persisted; e.g. a
  `.guard-block-count` sibling to the existing `.retry-count`), reset on any successful spawn or
  human intervention. The blocking guard increments it.
- REQ-2: After N consecutive blocks (default ~5), set `lane_action_status: failure` and post a
  single `❌` comment naming the persistent root cause (the disqualifying dirty paths), so it
  reaches the Inbox's "Needs your input". Stop appending per-cycle ⚠️ spam once escalated.
- REQ-3: Read the `workspaceGuardBlocked` flag that already exists, rather than adding a parallel
  signal.
- REQ-4: Exclude `_duplicate-*` folders from the lane concurrency counter — and/or clear their
  status markers at quarantine time, so a quarantined folder can never hold a parallel-limit
  slot. Quarantine must not be able to embalm a `running` marker.
- REQ-5: Manager sweep detects phantom `running` markers generally: a track marked `running` in
  the filesystem with no corresponding agent process and no live DB claim is reconciled (reset to
  `queue`) or escalated, not left to wedge a lane.
- REQ-6: Widen orphan-worker detection beyond "unregistered": a registered worker whose cwd no
  longer exists, or whose heartbeat is long dead, should also be reaped.
- REQ-7: Where a dirty path is provably junk (e.g. a tracked-but-deleted ignorable build output),
  the manager may propose or apply the fix. Exact safety boundary decided in planning — anything
  ambiguous escalates only, never auto-fixes.

## Acceptance Criteria

- [ ] AC-1: A permanently-dirty checkout drives a track to `lane_action_status: failure` with one
      ❌ comment within N cycles — reproduced against the 10036 shape — instead of looping.
- [ ] AC-2: A `_duplicate-*` folder containing `**Lane Status**: running` does not consume a
      parallel-limit slot; a track queued in that lane is still claimed.
- [ ] AC-3: A phantom filesystem `running` marker with no agent process and no DB claim is
      reconciled by the manager sweep within one sweep interval.
- [ ] AC-4: A registered worker process whose cwd is deleted is reaped (Finding 3's zombie case).
- [ ] AC-5: Escalated tracks appear in the Inbox's "Needs your input" bucket, verified against a
      real `/api/inbox` response, not just a unit assertion.

## Out of Scope

- Fixing the stale `tracksMetadata` cache itself — that is track 10036's job. This track handles
  the *consequences* (duplicates, phantom markers, wedged lanes) and the escalation path.
