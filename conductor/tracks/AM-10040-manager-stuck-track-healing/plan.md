# Track AM-10040: Manager Stuck-Track Healing

Three phases, ordered by how much each one stops the bleeding. Phase 1 alone ends the
191-comment forever-loop; Phase 2 unwedges lanes and reaps zombies; Phase 3 removes the
human step for the one cause we can prove is junk.

Line numbers below are from `conductor/laneconductor.sync.mjs` as of 2026-08-30 — re-locate
by symbol, not by number, since this file moves.

---

## Phase 1: Count pre-spawn blocks and escalate to failure

**Problem**: The two `err.workspaceGuardBlocked = true` throw sites (~4431 dirty-checkout,
~4462 main-mode-lock) fire *before* any spawn, so the exit handler's retry counter (~4922)
never runs and `max_retries_reached` structurally cannot fire. Every block reverts the track
to `queue` and appends a ⚠️ comment, forever. The flag itself is read nowhere.

**Solution**: A cause-generic, DB-persisted "pre-spawn block" counter, incremented at those
same two throw sites, that escalates to `**Lane Status**: failure` at a threshold. Escalation
is inline in the blocking worker — it is the only component that knows the cause, and it works
in local-fs where no manager exists (spec D1).

- [ ] Task 1: New pure module `conductor/services/prespawn-block.mjs` (no I/O, mirrors
      `workspace-mode.mjs` / `orphan-worker-detection.mjs` extraction style)
    - [ ] `BLOCK_KINDS` — `dirty-checkout`, `main-mode-lock`, plus the three names reserved for
          [[AM-10039-cloud-workers-claude-cloud]] (`expired-credentials`, `github-app-missing`,
          `preflight-failed`). REQ-9: escalation keys off count + kind, never off dirty-path shape.
    - [ ] `DEFAULT_ESCALATE_AFTER = 5`, overridable via `LC_PRESPAWN_BLOCK_ESCALATE_AFTER`
    - [ ] `decidePreSpawnBlockOutcome({ kind, reason, countBefore, threshold })` → one of
          `{ action: 'warn' }` (countBefore === 0 — first of streak), `{ action: 'silent' }`
          (mid-streak), `{ action: 'escalate' }` (countBefore + 1 >= threshold). This is REQ-10:
          exactly two comments per streak, spam killed at the source rather than capped at the end.
    - [ ] `formatBlockComment(outcome)` → the ⚠️ / ❌ body, leading emoji as the literal first
          character (Completion Comment Convention — this is what puts it in the Inbox)
- [ ] Task 2: DB persistence (REQ-8 — 10039's dispatcher-only mode has no local filesystem)
    - [ ] Migration `migrations/<ts>_add_track_prespawn_block.sql`:
          `ALTER TABLE tracks ADD COLUMN prespawn_block_count INTEGER NOT NULL DEFAULT 0,
          ADD COLUMN prespawn_block_kind TEXT, ADD COLUMN prespawn_block_reason TEXT,
          ADD COLUMN prespawn_blocked_at TIMESTAMPTZ`
    - [ ] Mirror the columns in `prisma/schema.prisma` and `prisma/schema.sql`
    - [ ] `ui/server/index.mjs`: `POST /track/:num/prespawn-block` (body `{ kind, reason }`;
          increments and returns the new `{ count, kind, reason }`) and
          `POST /track/:num/prespawn-block/reset`. Both behind `collectorAuth`, same shape as the
          existing `GET /track/:num/retry-count` (~3030)
- [ ] Task 3: Worker wiring in `spawnCli`
    - [ ] Extract the two near-identical block bodies at ~4418–4434 and ~4448–4465 into one
          `handlePreSpawnBlock({ trackNumber, kind, reason, primaryIndexPath, primaryIndexContent,
          primaryTracksDir, primaryTrackDirName, label })` helper
    - [ ] It increments the counter (API mode: the endpoint above; local-fs: sibling files
          `.prespawn-block-count` / `.prespawn-block-kind` / `.prespawn-block-lane`, exactly the
          `.retry-count` / `.retry-lane` pattern at ~4922), then applies the module's decision:
          revert to `**Lane Status**: queue` on warn/silent, or write `**Lane Status**: failure`
          on escalate, and post at most the one comment the decision calls for
    - [ ] Keep throwing the same error with `err.workspaceGuardBlocked = true` (REQ-3 — read the
          existing flag, do not add a parallel signal) and add `err.preSpawnBlock = outcome` so
          callers can log the distinction
- [ ] Task 4: Reset points — a stale counter is worse than no counter
    - [ ] On a spawn that gets past both guards: clear the counter (this is the "consecutive"
          in "consecutive blocks")
    - [ ] In the exit handler's `isSuccess` branch, alongside the existing `.retry-count` removal
    - [ ] On lane change, via the same `.retry-lane`-style guard
    - [ ] On human intervention — reuse the "since the last human comment" semantics the
          retry-count endpoint already implements, so a human comment or drag clears it
- [ ] Task 5: Distinguish the block in the three `spawnCli` callers (~5860 auto-queue, ~5953
      auto-complete, ~7230 manual-dispatch) — log `workspaceGuardBlocked` as a block, not a crash

**Impact**: The 10036 shape reaches `failure` + one ❌ within 5 cycles instead of looping.
Verified reachable: `autoLaunchLocalFs` skips any track with `lane_action_status !== 'queue'`
(~5703) and `resetStuckActions` only rewrites `running` rows, so `failure` is genuinely
terminal until a human touches it. The existing `/api/inbox` `body LIKE '❌%'` rule
(`ui/server/index.mjs` ~1046) already routes it to "Needs your input" — nothing new needed
there, only verification (AC-5).

---

## Phase 2: Manager sweep — phantom markers, wedged lanes, dead-cwd workers

**Problem**: Three separate leaks, all invisible to the guard.
1. `quarantineStaleFolder` (~1383) renames a duplicate to `_duplicate-*` but leaves its status
   markers intact, while `autoLaunchLocalFs`'s `dirs` filter (`/\d+/.test(d)`, ~5575) still
   matches it — so a quarantined folder frozen at `running` permanently burns a lane slot.
   **Confirmed live right now**: `conductor/tracks/_duplicate-10036-fix-stale-tracks-metadata-
   cache-in-resolvetrackfolder/index.md` holds `**Lane**: implement` / `**Lane Status**: running`.
   `alreadyRunning = Math.max(fromFiles, internalRunning)` (~5739) means the filesystem phantom
   always beats correct in-process state.
2. Nothing reconciles a filesystem `running` marker left by a process that died.
3. `reapOrphanedWorkerProcesses` (~6328) defines "orphan" as *unregistered*, so the real zombie
   (PID 1736711, ~17% CPU for 2 days against a deleted cwd) was invisible — it had registered.

**Solution**: Fix the counter directly, then give the manager a sweep for what only a
cross-project singleton can see.

- [ ] Task 1: Quarantined folders can never hold a lane slot (REQ-4 — both belts)
    - [ ] Exclude `_duplicate-*` from `autoLaunchLocalFs`'s `dirs` filter and from the
          `currentlyRunningPerLane` pre-pass. (Note `isWorkerBookkeepingPath` already exempts
          `_duplicate-*` from the *dirty-checkout* guard — this is the concurrency counter, a
          different scan that was missed.)
    - [ ] In `quarantineStaleFolder`, rewrite the renamed folder's `**Lane Status**: running` →
          `quarantined` so no future scan can resurrect the phantom either
    - [ ] Clear the one that exists today as part of this phase
- [ ] Task 2: New pure module `conductor/services/stuck-track-sweep.mjs`
    - [ ] `findPhantomRunningTracks({ fsRunning, livePids, runMarkers, dbClaims, graceMs })` →
          tracks marked `running` on disk with no live agent pid, no live run marker
          (`conductor/services/run-marker.mjs`), no live DB claim, and older than the grace window
    - [ ] `classifyPhantom(track)` → `reconcile` (first sighting → reset to `queue`) vs
          `escalate` (repeat offender → `failure`, reusing Phase 1's counter with a
          `phantom-running` kind)
- [ ] Task 3: `sweepStuckTracks()` in `laneconductor.sync.mjs`, gated on `isManager`, on its own
      interval (default 5 min, `LC_STUCK_SWEEP_INTERVAL_MS`), with an in-flight guard matching
      `orphanReconcileInFlight`. Cross-project: enumerate projects from the collector, read each
      one's `repo_path`/`conductor/tracks/`.
- [ ] Task 4: Widen orphan-worker detection (REQ-6) in
      `conductor/services/orphan-worker-detection.mjs`
    - [ ] `findOrphanedWorkerProcesses` takes registered workers with `{ pid, last_heartbeat }`
          plus a `cwdExists(pid)` probe (`readlink /proc/<pid>/cwd` → the ` (deleted)` suffix)
          rather than a bare `registeredPids` Set
    - [ ] Reap when: unregistered (today's rule, unchanged), **or** registered with a deleted cwd,
          **or** registered with a heartbeat older than a stale threshold. Keep the `graceMs`
          young-process guard and the never-reap-self rule on every branch.
    - [ ] Keep it a pure module — the `/proc` probe is injected, so it stays unit-testable
- [ ] Task 5: Verify the escalation actually reaches a human — drive a real `/api/inbox` response
      and confirm the escalated track lands in `needs_input` (AC-5; do not settle for a unit
      assertion on the SQL `CASE`)

**Impact**: A lane can no longer be wedged by a folder nobody is working in, a dead run no
longer holds a slot forever, and a registered-but-useless worker gets reaped.

---

## Phase 3: Known-safe auto-heal, propose-by-default

**Problem**: The 10036 root cause — `ui/node_modules` committed as a symlink, then ignored, so
`git status` reports `D ui/node_modules` permanently — is trivially fixable and provably junk,
but currently needs a human to notice a ❌ comment first.

**Solution**: A narrow, closed-allowlist healer that proposes by default (spec D3/D4).

- [ ] Task 1: New pure module `conductor/services/dirty-path-heal.mjs`
    - [ ] `classifyHealableDirtyPath({ path, porcelainStatus, isGitIgnored })` → `{ healable,
          remedy, reason }`. Healable **only** when all three hold: status is deleted-from-worktree
          (`D`), the path is currently git-ignored, and its basename is on the closed allowlist
          (`node_modules`, `dist`, `build`, `out`, `.next`, `coverage`, `.venv`, `__pycache__`,
          `.turbo`). Anything else → `healable: false`, escalate only.
    - [ ] The only remedy ever emitted is `git rm -r --cached <path>` — index-only. Never a
          filesystem delete, never a content edit.
- [ ] Task 2: Propose path (default). Phase 1's ❌ escalation comment includes the exact remedy
      command when a healable path is found; the git index is left untouched.
- [ ] Task 3: Apply path (opt-in). `manager.auto_heal: true` in `.laneconductor.json` lets the
      manager run the remedy: take the global main-mode lock first
      (`checkAndClaimGlobalMainModeLock`), run it, commit
      `fix(manager): untrack ignored build output <path>`, release, and post a ✅ comment naming
      what it did. Absent/false → propose only.
- [ ] Task 4: Full regression suite for all three phases — see `test.md`. The 10036 shape
      (permanently-dirty checkout, `Auto Run: yes`) is the headline regression: it must reach
      `failure` with exactly two comments within N cycles.

**Impact**: The single most common permanent cause self-heals once a human opts in, and every
other cause still escalates to a person rather than spinning.

---

## Notes / Risks

- **Ordering with [[10036-fix-stale-tracks-metadata-cache-in-resolvetrackfolder]]**: 10036 fixes
  the stale-cache bug that *manufactures* the duplicates; this track handles the consequences.
  They are independent and can land in either order, but the duplicate folders will keep
  reappearing until 10036 lands. Explicitly out of scope here.
- **Reserved-kind coupling with [[AM-10039-cloud-workers-claude-cloud]]**: 10039 consumes this
  counter rather than rebuilding it. The DB columns and the `kind` discriminator (REQ-8/REQ-9)
  are the contract — do not make the schema or the escalation logic dirty-checkout-specific.
- **This track is itself blocked by the bug it fixes.** Its own plan run was blocked by dirty
  paths from 10036 and 10039. Expect implement to hit the same guard; that is a live test, not
  an obstacle to route around.
- **Threshold choice.** 5 blocks at a ~2-minute auto-launch cadence is roughly 10 minutes of
  transient dirtiness tolerated before escalation. The 30s in-guard settle window
  (`DIRTY_RETRY_MAX_MS`) already absorbs sub-minute flapping, so 5 is deliberately generous.
