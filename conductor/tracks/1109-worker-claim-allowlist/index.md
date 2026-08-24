# Track 1109: Worker claim allowlist — scope which tracks a worker may claim

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Phase**: Quality gate PASSED — done
**Type**: dev
**Summary**: "Start a worker" today means "consume the whole queue", so you cannot run one track without collateral. Add a claim allowlist plus an `lc worker run <track>` front door, making scoped invocation the…

## Problem

Starting a worker is currently all-or-nothing: `lc worker start
--sync-and-work` polls the queue and claims whatever it finds. On this
machine that means tracks 10003–10007 and others sitting in `plan queue`
would immediately begin autonomous agent runs.

That makes a worker unusable as a **tool** — you cannot say "run this one
track" without accepting every other queued track as collateral. It blocked
track 1100's last acceptance criterion (the slow-tier E2E specs need a live
`sync+poll` worker to claim their own test track), and it is the same reason
a CI job can't safely run those specs.

**The mechanism to fix this already exists and is wired end to end** — it
just degrades to "claim everything" in local mode:

- `GET /api/projects/:id/claimable-tracks` (`ui/server/index.mjs:3770`,
  track 1084 Phase 3) already answers "which queued tracks may THIS worker
  claim", per `worker_id`.
- The worker already gates on it — `conductor/laneconductor.sync.mjs:4089`:
  `if (claimableSet && !waitingForReply && !claimableSet.has(track_number)) continue;`
- But scoping is identity-derived (`ui/server/index.mjs:3576`):
  `track.assignee_uid ?? track.created_by_uid ?? project.owner_uid ?? null`.
  In a no-auth local deployment all three are null, so `resolveAssignee`
  returns null and the endpoint takes its `// no owner info at all — open
  claim` branch. **Local mode has no identities, so identity-based scoping
  admits everything.**

Worth being precise about what this is NOT: it is not an isolation problem.
`lc lock` already gives each track its own git worktree (~45 under
`.worktrees/`). Isolation is solved; **admission control** is not. Nor is it
solved by spawning "sub-workers" — a sub-worker with the same claim
predicate claims the same tracks. Sub-agents in other agentic tools avoid
this by being *push*-scoped (handed their task); a LaneConductor worker is a
*pull*-based queue consumer, and a pull consumer can only be scoped by a
claim predicate.

## Solution

Add an explicit, non-identity claim allowlist to the worker, intersected
with the existing `claimableSet` gate:

```bash
lc worker start --sync-and-work --only-tracks 1100,10008
```

No schema change and no new subsystem — it reuses the gate at
`laneconductor.sync.mjs:4089`. A worker started this way is structurally
incapable of claiming anything else.

### This is intended to become the normal way to run a worker

Not a niche flag for tests. Today "start a worker" means "start a daemon
that will consume the whole queue", which is only safe when you actually
want everything run — a rare situation, and an alarming default on a machine
with real queued work. The ordinary intent is *"run this track"*. Scoped
invocation should be the front door, with unbounded queue consumption as the
deliberate opt-in rather than the only option.

That implies more than a flag; it implies an ergonomic first-class command
and a matching lifecycle:

```bash
lc worker run 1100        # claim exactly this track, work it, exit
```

Design questions this raises, to settle during planning rather than assume:

- **Exit semantics.** A scoped worker whose tracks are all finished should
  probably exit rather than idle-poll forever — that is what makes it usable
  as a foreground tool and in CI. Does `--only-tracks` imply exit-when-done,
  or is that a separate `--once`?
- **Relationship to `lc worker start`.** Is `run` a thin wrapper over
  `start --sync-and-work --only-tracks <n> --once`, or its own path? Prefer
  a wrapper — one execution path, no divergence.
- **Should the unscoped default change?** Arguably `--sync-and-work` with no
  scope should require an explicit `--all` to consume the whole queue. That
  is a breaking change to a documented flag, so it needs a decision, not a
  drive-by.
- **Interaction with `worker.mode`** in `.laneconductor.json` (track 1042's
  `sync-only` vs `sync+poll`) — a scoped run is a third shape and shouldn't
  quietly contradict the configured mode.

### ⚠️ Constraint: a scoped/exiting worker MUST reuse a stable identity

The obvious worry about per-task workers is cost — if each run cold-starts an
agent, every task pays to rebuild the whole context. Two things have to be
kept apart here:

- The **worker process** is a Node daemon. Starting and stopping it is
  effectively free; no LLM is involved.
- The **agent session** (the `claude` CLI invocation) is the expensive part.

The claim allowlist only affects the first, so it is cost-neutral on its own:
a whole-queue worker running 5 tracks spawns the same 5 agent sessions a
scoped worker would.

What actually governs rebuild cost is track 1086's session persistence, and
critically **it lives server-side, not in the worker process**:

- `resolveTrackSession` (`laneconductor.sync.mjs:3840`) asks the collector
  `GET /track/:num/session`.
- The row lives in `track_sessions`, keyed **`(track_number, worker_id)`**
  (`ui/server/index.mjs:2523`).
- Hit → `--resume <id>` + `FRESH_SESSION: false`; miss → `--session-id <new>`
  + `FRESH_SESSION: true`.

So the session **survives worker exit** — exit-when-done does not by itself
force a context rebuild. But resumption is keyed on `worker_id`, so:

> If an ephemeral scoped worker registers under a **fresh identity** each
> run, it gets a new `worker_id`, misses the `track_sessions` row, and cold
> rebuilds context on every single invocation — silently, with no error.

Track 1084 Phase 0 already made `worker_number` (not pid) the identity key
precisely so restarts stop orphaning FK'd rows. A scoped worker must reuse a
stable `hostname` + `worker_number` to inherit that. **Phase 6 must assert
this directly**: run the same scoped track twice and confirm the second run
receives `FRESH_SESSION: false`. A passing functional test that silently
cold-starts every time is exactly the kind of false green track 1100 was
opened over.

### Two related gaps found while checking the above

1. **Session persistence is disabled in local-fs mode.** `resolveTrackSession`
   opens with `if (getIsLocalFs() || !myWorkerId) return null` — no collector,
   no `track_sessions`. So in local-fs *every* run is a cold start regardless
   of scoping. Out of scope here, but it is the mode where the cost concern
   fully applies, and it is currently unaddressed.
2. **Continuity-first routing was left as a follow-up and never done.**
   `claimable-tracks` carries the comment: *"Continuity-first routing via
   track_sessions — track 1086 — is a follow-up once that table exists; this
   is the assignee gate alone."* The table exists now. Preferring the worker
   that already holds a track's session is the actual cost optimisation for
   multi-worker setups, and it lands in the same function this track edits —
   worth sequencing deliberately rather than colliding with it.

## Phases
- [ ] Phase 1: `--only-tracks <csv>` flag in `bin/lc.mjs`, forwarded to the sync worker alongside the existing `--sync-and-work` / `--sync-only` flags.
- [ ] Phase 2: Parse it in `laneconductor.sync.mjs` and intersect with `claimableSet` at the existing gate. Must apply in **local-fs mode too**, where `claimableSet` is null (that is the mode with no identities, so it needs this most).
- [ ] Phase 3: Exit-when-done semantics for a scoped worker, so it works as a foreground tool and in CI rather than idling forever. Settle the `--once` question from the design notes above.
- [ ] Phase 4: `lc worker run <track>` as the ergonomic front door — a thin wrapper over the scoped path, not a second implementation.
- [ ] Phase 5: Make the scope observable — log the effective claim scope at startup and surface it on the worker card, so a scoped worker is not mistaken for a broken one that "won't pick anything up".
- [ ] Phase 6: Tests — a scoped worker claims its listed track, provably leaves an unlisted queued track alone (assert the negative, not just the positive), exits when done, and on a second run for the same track receives `FRESH_SESSION: false` (proving session resumption survived the exit rather than silently cold-starting).
- [ ] Phase 7: Document in `SKILL.md` + `lc worker --help`, lead with `lc worker run <track>` as the normal path, and note it in `conductor/quality-gate.md` as the safe way to run the slow E2E tier.

## Non-Goals

- Making the slow E2E specs fast. They drive real agent runs; they stay
  opt-in regardless of how the worker is scoped.
- `assigned_worker_id` on tracks / explicit pinning. That is the more general
  fix and `claimable-tracks` already has the right shape for it, but it needs
  a migration and is worth its own track.
- Changing the default behaviour of an unscoped `--sync-and-work` in this
  track. It is raised as a design question above and may well be right, but
  it is a breaking change to a documented flag and should be decided
  explicitly, not folded in here.

## Unblocks
[1100](../1100-fix-playwright-e2e-suite/index.md) — its last open acceptance
criterion ("the slow tier passes when explicitly invoked") is blocked purely
on not being able to start a worker safely. With `--only-tracks`, the slow
tier can be observed green without side effects on the queue.
