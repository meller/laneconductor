# Track 10015: Worktree dispatch reliability — refresh-worktrees bug + duplicate worker process race

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Last Run**: claude/sonnet (primary)
**Phase**: Quality gate passed — Phase 1 (refresh-worktrees fix) verified with a real spawned worker; Phase 2 (duplicate worker process race) superseded by track 1084 Phase 8, verified via its watchdog test.
**Type**: bug
**Summary**: Two issues found live while chasing a "can't delete worktree from the UI" report (2026-08-17): refresh-worktrees dispatches always fail with "missing track_number" (a real handler bug, fixed here), and — the…

## Problem

Found while investigating why two "Remove worktree" clicks on detached-HEAD
worktrees (`.worktrees/9998`, `.worktrees/9999`) appeared to do nothing —
the rows stayed in the Worktrees panel with no error. Root-caused live,
not from a stack trace:

### Bug 1 — `refresh-worktrees` dispatches always fail with "missing track_number" ✅ FIXED (unit-tested)

`POST /api/projects/:id/dispatch` (`ui/server/index.mjs:3413-3415`)
explicitly exempts `remove-worktree` and `refresh-worktrees` from
requiring a `track_number` on enqueue — by design, neither action is
scoped to a track. But something on the worker side still expects one:
every `refresh-worktrees` dispatch observed live failed immediately with
`status: 'failed', result: 'missing track_number'`. Seven consecutive
real dispatches (ids 657–663, created every ~30-60s while the UI kept
retrying) all failed the same way. Never actually refreshes anything.

**Fixed 2026-08-17**: `checkDispatchInbox()` had no dedicated branch for
`refresh-worktrees` at all — it fell through to the generic lane-action
fallback, which unconditionally requires `track_number`. Added a
dedicated branch (`conductor/laneconductor.sync.mjs`, right after
`remove-worktree`'s own) that calls `refreshWorktreeSummaryCache()`
directly and reports the dispatch `done`. See plan.md Phase 1 for the
full test/verification detail.

### Bug 2 — Two worker processes can register under the same identity and race for one dispatch inbox, undetected → FIXED ELSEWHERE (track 1084 Phase 8, same day, same incident)

**Superseded 2026-08-17, same day**: this is the exact same live incident
— found and fixed independently, more thoroughly, by concurrent work on
[1084](../1084-worker-identity-and-assignment/index.md) Phase 8 (commit
`ded81ee` and the code it references) while this track's own writeup was
still open. Their diagnosis went one step further than this section's:
the real gap wasn't the duplicate process existing (track 1110's
`worker-lock.mjs` already prevents that going forward) — it's that
`updateWorkerHeartbeat()` upserts by identity without ever checking
`myWorkerId`, so a worker whose registration never actually resolved
looks completely healthy (idle, heartbeating on schedule, visible in the
UI) while silently never serving a single dispatch. Their fix: a
watchdog that specifically detects "`myWorkerId` still null N seconds
after startup," logs once loudly, and retries registration until it
self-heals — `conductor/tests/worker-id-watchdog.test.mjs`. Verified
alongside this track's own Phase 1 fix and F8's test — all pass
together.

Leaving the rest of this section as originally written below, for the
record of what was independently observed here before the duplicate
work was discovered — no further action needed on this track for Bug 2.

The actual cause of the stuck queue: at the time of investigation, two
`node conductor/laneconductor.sync.mjs --sync-only` processes were both
running for this project — an older one (no longer tracked by
`conductor/.sync.pid`, apparently left over from an earlier restart in
the session) and a newer, pidfile-tracked one. Both share the same DB
worker identity (`project_id, hostname, worker_number`), so both
register as (and get dispatches addressed to) the **same** `workers.id`.

Observed effect: 12 dispatches — including the two real "Remove
worktree" clicks — sat `status: 'pending'` for ~9 minutes straight,
untouched. `GET /worker/:id/dispatch` on the server confirmed all 12
were sitting there correctly the whole time (server-side was fine); the
live worker's own `checkDispatchInbox()` polling simply produced zero
log output — no fetch attempt, no error — for that entire window. The
older orphaned process eventually died on its own; the moment the
surviving process's next poll tick ran, it claimed and correctly
processed the entire backlog (both worktrees were actually removed).

So the underlying failure mode isn't (as first suspected) a bug in
`remove-worktree`'s own logic — that logic is correct and was verified
working the instant a functioning process picked the dispatch up. It's
that **nothing detects or prevents two processes racing the same worker
identity**, and when that happens, there's no visible signal (no error,
no stuck-worker warning, nothing in the Activity panel) that dispatches
addressed to that identity might not be getting serviced at all — it
just looks like "clicking the button does nothing," identical to how
track 1114's `window.confirm()` bug originally presented, but with a
completely different cause.

Fix direction (needs more design than Bug 1):
- At minimum, detect the collision: on registration/heartbeat, if a
  worker upserts under an identity `(project_id, hostname,
  worker_number)` whose existing row has a **different**, still-live
  `pid`, that's a strong signal of a duplicate process — log it loudly,
  and/or surface it in the UI (a stuck-worker warning) rather than
  silently interleaving heartbeats from both.
- Consider whether `lc worker start`/`restart` should refuse to start a
  second process for the same identity while a live one (recent
  heartbeat, live PID on the same host) is still running, instead of
  relying on the pidfile alone — the pidfile can point at the "new"
  process while an old one it never actually killed keeps running
  independently, which is exactly what happened here.
- Separately worth asking: why did `checkDispatchInbox()` on the old
  process stop producing *any* output (not even the "Failed to fetch
  inbox" warning its own catch block would log on a real fetch error)?
  That's still unexplained — the process died before it could be
  inspected further. Might be worth adding a periodic "still polling"
  heartbeat-level log line so a wedged inbox loop is visible without
  needing to catch it live.

## Depends on
[1084](../1084-worker-identity-and-assignment/index.md) (worker
identity model), [1102](../1102-e2e-session-findings/index.md) (F8's
dispatch failure-reporting fix — related infrastructure, found while
using the same live-worker debugging approach, but this track's Bug 2
is about duplicate *processes*, not a single process's error handling).
