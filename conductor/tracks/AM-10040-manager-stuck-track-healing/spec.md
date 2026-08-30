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
- REQ-8 (added in planning, from [[AM-10039-cloud-workers-claude-cloud]]'s cross-track note): the
  block counter and escalation state are persisted in the **database** (`tracks` columns), not
  only as filesystem sibling files. 10039's dispatcher-only mode has no local `conductor/tracks/`
  to hold a `.guard-block-count`, so a file-only design would force it to rebuild the mechanism.
  Local-fs mode still writes sibling files — it has no DB — but the DB is the canonical store
  wherever one exists.
- REQ-9 (added in planning): the counter is **cause-generic**, not dirty-checkout-specific. Every
  record carries a `kind` discriminator (`dirty-checkout`, `main-mode-lock`, and, reserved for
  10039, `expired-credentials` / `github-app-missing` / `preflight-failed`). Escalation logic
  keys off count + kind, never off the dirty-path shape, so 10039 reuses it by passing a new
  `kind`.
- REQ-10 (added in planning): the ⚠️ spam is fixed at the source, not merely capped at escalation.
  A ⚠️ comment is posted only on the **first** block of a streak; blocks 2..N−1 are logged only;
  block N posts the single ❌. A permanent block therefore produces exactly two comments total
  (one ⚠️, one ❌) rather than 191.

## Design Decisions (resolved in planning)

- **D1 — Who escalates.** Both, splitting by what each can see. The *blocking worker* escalates
  inline at block time (Phase 1): it is the only component that knows the cause, it works in
  local-fs where no manager exists, and it has no sweep latency. The *manager sweep* (Phase 2)
  handles what the guard structurally cannot see — phantom `running` markers left by a process
  that died, quarantined folders holding lane slots, and dead-cwd workers. The shared
  classification/threshold logic lives in one pure module used by both, so the two paths can
  never disagree.
- **D2 — Escalation terminal state.** `**Lane Status**: failure` on the track's own lane (not a
  lane change). Verified this genuinely stops the loop: `autoLaunchLocalFs` skips any track whose
  `lane_action_status !== 'queue'` (`laneconductor.sync.mjs:5703`), and `resetStuckActions` only
  rewrites `running` rows, so nothing re-queues it. Any human intervention (comment, drag) clears
  it via the existing retry-reset path.
- **D3 — Phase 3 auto-heal safety boundary.** A dirty path is healable **only** when all three
  hold: (a) `git status --porcelain` reports it deleted-from-worktree (`D`), (b) `git check-ignore`
  confirms it is currently git-ignored, and (c) its basename is on a closed allowlist of build
  output (`node_modules`, `dist`, `build`, `out`, `.next`, `coverage`, `.venv`, `__pycache__`,
  `.turbo`). The only permitted remedy is `git rm -r --cached <path>` — index-only. Never a
  filesystem delete, never a content edit, never a path failing any of (a)–(c).
- **D4 — Propose before apply.** Default behavior is **propose**: the ❌ escalation comment
  includes the exact remedy command for a human to run. Applying it automatically requires an
  explicit `manager.auto_heal: true` opt-in in `.laneconductor.json`; when enabled the manager
  takes the global main-mode lock before touching the index and commits the change. A tool that
  wedges tracks should not earn unattended write access to `main` on the same release that fixes
  the wedging.

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
- [ ] AC-6: A permanently-blocked track produces exactly **two** system comments across the whole
      streak (one ⚠️ at the first block, one ❌ at escalation) — counted from a real
      `conversation.md` after N+2 auto-launch cycles, not asserted from the formatting function.
- [ ] AC-7: The block counter survives a worker process restart and is readable without the
      filesystem — after escalation, `GET /track/:num` (or the tracks row) reports the recorded
      count, kind, and reason, so 10039's dispatcher-only mode can consume it.
- [ ] AC-8: A transient block does **not** escalate: a checkout that is dirty for the first block
      and clean by the next cycle spawns normally, and the recorded count is back to 0 afterwards.
- [ ] AC-9: With `manager.auto_heal` unset, a healable `D ui/node_modules` path is only *proposed*
      — the ❌ comment names `git rm -r --cached ui/node_modules` and the git index is verifiably
      unchanged. With it enabled, the same scenario ends with the path untracked, the checkout
      clean, and the previously-stuck track spawning on the next cycle.

## Out of Scope

- Fixing the stale `tracksMetadata` cache itself — that is track 10036's job. This track handles
  the *consequences* (duplicates, phantom markers, wedged lanes) and the escalation path.
