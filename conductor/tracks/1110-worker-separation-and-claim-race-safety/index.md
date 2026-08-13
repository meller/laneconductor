# Track 1110: Worker process separation + atomic track claiming

**Lane**: review
**Lane Status**: queue
**Progress**: 100%
**Phase**: All 5 phases complete 2026-08-13 — reproduction, worker separation, API-mode + local-fs-mode claim atomicity, full regression (incl. live production dogfood). Ready for review.
**Type**: dev
**Summary**: Two related safety gaps found live while dogfooding: (1) a worker restart can leave two OS processes sharing one identity because the pidfile guard trusts a possibly-stale local file, and (2) the…

## Problem

### A. Worker separation — the pidfile guard can be wrong

`getRunningWorkerPid()` (`bin/lc.mjs:76`) is a good check as far as it
goes — liveness (`kill(pid,0)`) plus a `/proc/<pid>/cmdline` cross-check
against PID reuse. But it only ever consults **the pidfile it's about to
overwrite**. If that file is stale, empty, or was never written (a
process started outside `lc worker start`, or a prior `stop` that failed
silently), the guard sees "nothing running" and `start` spawns a second
process — even though a live `laneconductor.sync.mjs` for the exact same
(project, hostname, worker_number) identity is still running.

**Reproduced live, 2026-08-13** (see [1102](../1102-e2e-session-findings/index.md) F10's
addendum): a routine `make lc-stop && make lc-start`, done only to pick up
a config change, left two processes (420522 and 571355) both writing the
same log file and both attempting to register as project 1 /
`meller-X1-AI` / worker_number 1. The DB's unique constraint
(`workers_project_id_hostname_worker_number_key`) meant only one row could
hold the identity at a time — but nothing stopped **two OS processes**
from existing and both heartbeating/registering against it, each
overwriting the other's `pid` on every cycle. One was mid-`implement`-run
on a real track when this was noticed and manually resolved by diffing
`ps` against the DB row and killing the redundant process by hand.

### B. Claim race — the atomic path exists but isn't used

`POST /tracks/claim-queue` (`ui/server/index.mjs:2287`) is a real,
tested, atomic claim: `UPDATE ... FROM (SELECT ... FOR UPDATE SKIP
LOCKED) ...` inside a transaction — the textbook safe pattern, and two
workers racing it genuinely cannot double-claim.

**But the worker never calls it.** `laneconductor.sync.mjs`'s own comment
says so directly (line ~4849): *"Launch decisions are always
filesystem-based (same as local-fs mode). DB is used only for heartbeats
and UI sync, not for concurrency control."* Both local-fs mode AND
local-api/remote-api (sync+poll) mode funnel through `autoLaunchLocalFs()`
(line 3999), which:
1. `readFileSync`s `index.md`, checks `lane_action_status === 'queue'`
2. Decides to claim
3. `writeFileSync`s `Lane Status: running`
4. `spawnCli`s

Steps 1 and 3 are not atomic with each other, and there is no lock of any
kind (file lock, DB row lock) between them. **If two sync+poll worker
processes exist for one project — exactly what scenario A can produce —
both can read `queue` in the same tick and both spawn a CLI run for the
same track.** The already-built `FOR UPDATE SKIP LOCKED` endpoint sits
unused for this purpose (it does have real callers — see
`ui/server/tests/track-1033-worker-auth.test.mjs` — but not the worker's
own auto-launch loop; `cloud/functions/index.js` implements the same
endpoint separately, suggesting it was built for a serverless/cloud-worker
execution model that never got wired to the local heartbeat worker).

## Solution (two independent problems — not yet decided, see Phases)

**A — worker separation.** Preferred direction: replace (or supplement)
the pidfile-liveness check with an OS-level advisory lock
(`flock`/`proper-lockfile` on a lock file per (project, worker_number))
held for the process's entire lifetime. Unlike a pidfile, the OS releases
an flock automatically the instant the holding process dies — no stale
data possible, no cross-checking cmdlines needed. `lc worker start`
attempts a non-blocking lock; failure to acquire it means "already
running", full stop, regardless of what any pidfile says.

**B — claim atomicity.** Two sub-cases needing possibly different
answers:
- **local-api/remote-api mode** (DB present): wire the worker's
  auto-launch loop to actually call `POST /tracks/claim-queue` instead of
  deciding from a raw file read — the atomic mechanism already exists and
  is tested; it's a wiring change, not new infrastructure. `autoLaunchLocalFs`
  would then only *execute* what the claim already granted, not decide.
- **local-fs mode** (no DB): needs its own exclusivity primitive, since
  there's nothing to lock in Postgres. Candidate: an atomic
  `rename()`-based claim file per track (`.claim-<track>` created via
  `open(..., 'wx')`, which is atomic and fails if it already exists) written
  synchronously before the queue-status check is trusted.

## Phases
- [ ] Phase 1: Confirm scope with a reproduction test for each problem — a test that starts two worker processes/instances against one project directory and shows (a) both register, (b) both claim the same track — before writing any fix (systematic-debugging: root cause is understood via code reading, but an automated repro locks it in and proves the fix later)
- [ ] Phase 2: Problem A — flock-based single-instance guard in `bin/lc.mjs`, replacing/supplementing the pidfile check
- [ ] Phase 3: Problem B (API mode) — wire `autoLaunchLocalFs`'s API-mode branch to `POST /tracks/claim-queue` instead of deciding from the raw file read
- [ ] Phase 4: Problem B (local-fs mode) — atomic claim-file primitive for the no-DB case
- [ ] Phase 5: Tests for all of the above, incl. the two-process repro from Phase 1 now passing

## Depends on / relates to
[1102](../1102-e2e-session-findings/index.md) F10 — where problem A was first hit live (this track is the real fix; 1102's fix was the soft-delete/re-register safety net for when identity collisions happen, not prevention of the collision itself — the two are complementary).
[1109](../1109-worker-claim-allowlist/index.md) — edits the same claim/auto-launch region (`autoLaunchLocalFs`'s claimableSet gate, `claimable-tracks`) for a different purpose (authorization scoping, not exclusivity). Land sequencing matters — coordinate rather than parallelize.
[1084](../1084-worker-identity-and-assignment/index.md) — this track's whole premise (stable worker identity) is what problem A undermines when two processes share one identity.

## Notes

Not yet implemented — this index documents the investigation and a
proposed design. Given this touches the core claim/spawn path every
project's worker runs through, the design (especially B's "wire to the
existing endpoint" vs. "build a new one" choice) should be confirmed
before implementation starts.
