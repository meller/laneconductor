# Track AM-10040: Manager Stuck-Track Healing — Escalate Permanent Workspace-Guard Blocks

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Last Run**: claude/claude-opus-5 (primary)
**Phase**: Replanned (7 phases) — Phase 1 ready to implement
**Type**: dev
**Track Kind**: bug
**Workspace**: branch
**Auto Run**: yes
**Waiting for reply**: no
**Author**: AM
**Created By**: asaf.meller@gmail.com
**Summary**: Stuck-track detection exists (reset-stuck-actions stamps stuck_timeout) but its only remedy is re-queue, so a track blocked by a *permanent* cause loops forever — track 10036 bounced…

## Problem

Live incident (2026-08-30, track 10036): the plan-lane action runs in `workspace: main`, whose
dirty-checkout guard blocked the spawn because `ui/node_modules` — accidentally committed to git
as a symlink — permanently shows as deleted (`D ui/node_modules`). The loop that resulted:

1. `resetStuckActions` (every worker, every 2 min → `POST /tracks/reset-stuck-actions`) resets the
   stale `running` row to `queue` + `lane_action_result: stuck_timeout`. Detection works.
2. `Auto Run: yes` → worker re-claims → `running` → dirty-checkout guard blocks before spawn
   (`laneconductor.sync.mjs` ~4380), reverts Lane Status to `queue`, appends a ⚠️ comment.
3. Repeat forever. 191 "Main-mode run blocked" comments accumulated in 10036's conversation.md.

Why it never escalates:
- Retry counting lives in the spawned process's **exit handler** (~line 4879); the guard throws
  **before** any spawn, so no failure is ever counted and `max_retries_reached` can never fire.
- The guard tags its error `err.workspaceGuardBlocked = true` — but that flag is **never read
  anywhere**. Dead code; callers treat the block as transient.

So a permanent block is indistinguishable from a transient one, produces an invisible forever-loop
instead of a `failure` state, and nothing surfaces in the Inbox's "Needs your input".

## Solution

Give the manager worker (track 1091's machine-level singleton) a periodic stuck-track healing
sweep — it's the one worker with cross-project scope and no per-project claim bias:

- **Detect the loop**: count consecutive workspace-guard blocks per track (persisted, e.g. a
  `.guard-block-count` sibling to the existing `.retry-count`; reset on any successful spawn or
  human intervention). The blocking guard itself increments it — the manager reads it.
- **Escalate**: after N consecutive blocks (default ~5), the manager sets
  `lane_action_status: failure` and posts a single `❌` comment naming the persistent root cause
  (the disqualifying dirty paths), so it lands in "Needs your input" instead of silently spinning.
  Stop appending the per-cycle ⚠️ spam once escalated.
- **Heal known-safe causes**: where the dirty path is provably junk (e.g. a tracked-but-deleted
  path that is ignorable build output like `node_modules`), the manager may propose or apply the
  fix — exact safety boundary to be decided in planning; anything ambiguous only escalates, never
  auto-fixes.
- Regression coverage for the 10036 shape: permanently-dirty checkout must reach `failure` + one
  ❌ comment within N cycles, not loop.

## Phases

Ordered by live damage rate, not by the order the findings were written. The original three
phases are now 5–7; Findings 4–7 produced the four that go first.

- [ ] Phase 1: One lane list + claims that say why they failed (REQ-13, 14 — Finding 5)
- [ ] Phase 2: Stale-process containment, then detection (REQ-12, 11 — Finding 4)
- [ ] Phase 3: One folder resolver, skill included (REQ-15 — Finding 6)
- [ ] Phase 4: Invalid resting states (REQ-16, 17 — Finding 7)
- [ ] Phase 5: Pre-spawn block counting + escalation to failure (REQ-1, 2, 3, 8, 9, 10 — Finding 1)
- [ ] Phase 6: Manager sweep — phantom markers, wedged lanes, dead-cwd workers (REQ-4, 5, 6)
- [ ] Phase 7: Known-safe auto-heal, propose-by-default (REQ-7)
**Waiting for reply**: yes
