# Spec: Remote collector sync fails silently — token resolution is start-time-only, and failures are invisible

## Problem Statement

The sync worker is the only component in the system that writes to a remote
collector. Every one of those writes failed for an entire worker lifetime and
nothing anywhere surfaced it.

**Confirmed live** (`conductor/.sync.log`, primary checkout, 2026-09-04):

| Signal | Count |
|---|---|
| `[collector-1] write failed: 401 {"error":"unauthorized: missing token"}` | 560 |
| `[collector-1] write failed: 404` | 12 |
| `[collector-1] write failed: 400` | 4 |

The 560 `401`s are byte-contiguous in the log between offsets `3110323131`
and `3126868365`, bracketed by exactly one worker startup (offset
`3093581384`) and the next restart (offset `3126916886`). They are one
process's entire remote-write output, and the restart is what ended them.

### What the investigation actually found

The track's original problem statement attributed this to a worker running
with its cwd inside a git worktree, where the gitignored `.env` does not
exist. **That is not what caused this incident.** The worker that emitted all
560 failures printed its own startup provenance as:

```
[LaneConductor] Serving from /home/meller/Code/laneconductor (primary checkout).
```

It was in the primary checkout, where `.env` exists and where
`COLLECTOR_1_TOKEN` parses correctly today (40-char `lc_live_…`, verified
against the worker's own parser). So the token was reachable on disk and the
worker still sent no credential.

The real mechanism is a **lifecycle mismatch between two config sources that
are read at different times**:

- `.laneconductor.json` is **hot-reloaded**. A chokidar watcher at
  `conductor/laneconductor.sync.mjs:2907` re-parses it on every change and
  replaces `config` wholesale (line 2919), so `getCollectors()` (line 391)
  starts returning a newly added collector immediately, mid-process.
- `.env` is read **exactly once**, at module load
  (`conductor/laneconductor.sync.mjs:324`), and never again for the life of
  the process.

`.env`'s mtime is `2026-09-03 11:36`; `.laneconductor.json`'s is
`2026-09-03 11:40`. A worker that was already running when the remote
collector was added therefore learned about `collectors[1]` and never learned
about `COLLECTOR_1_TOKEN`. `resolveToken()` (line 935) returned `null`,
`post()` (line 686) omits the `Authorization` header entirely because it is
guarded by `if (token)`, and the Cloud Function's `auth` middleware
(`cloud/functions/index.js:225`) correctly answered *missing token* — not
*invalid token*. The error text was pointing at the mechanism the whole time.

### The cwd hazard is real but currently masked

Reading `.env` via a bare relative `existsSync('.env')` is still
cwd-dependent. It is currently masked by track 10019's chdir-to-primary
(`conductor/laneconductor.sync.mjs:171`), which runs at line 171 — before the
`.env` load at line 324 — purely as an ordering side effect that nothing
documents or tests. Two live gaps remain:

1. `resolvePrimaryCwdDecision()` (`conductor/services/primary-cwd.mjs:28`)
   **never redirects a `--manager` worker**, by design. A manager worker is
   running on this machine right now (PID 16266). Its `.env`, and its
   `.laneconductor.json` and `conductor/defaults.json` (lines 343 and 355,
   also bare relative reads), resolve against whatever cwd it was launched
   with.
2. `LC_SKIP_CWD_NORMALIZATION` disables the chdir outright.

So the narrow fix from the original report is still worth doing — as explicit
intent rather than as an accident of statement ordering.

### Why it stayed invisible for 560 failures

`postToCollectors()` (line 976) and `patchCollectors()` (line 994) are the
system's only remote fan-out point. Collector 0 is awaited and its result
returned; collectors 1..n are fire-and-forget with a `.catch` that calls
`console.warn` and nothing else. There is no counter, no consecutive-failure
tracking, no retry, no per-track remote-sync state, no heartbeat field, and no
UI surface. 560 consecutive total failures produced nothing a human could see
short of grepping a 3.3 GB log.

### Ownership, for the record

The **worker** owns remote sync. The local API server does not write to the
cloud: `ui/server/index.mjs`'s `collectorWrite` posts to `COLLECTOR_URL`,
which defaults to `http://127.0.0.1:8091` — itself (line 46). It holds a
`CLOUD_FUNCTIONS_URL` constant (line 128) used **only to proxy reads** in
production, which makes it look cloud-responsible for writes when it is not.

## Solution

Two separable fixes, plus the surfacing work that is the actual reason this
track exists.

1. Make token resolution **cwd-independent and reload-aware**, so neither
   "wrong directory" nor "token added after the worker started" can silently
   produce an unauthenticated request.
2. Make an unauthenticated or failing remote write **loud** — at resolution
   time, in aggregate, in the heartbeat payload, and in the UI.
3. Add a bounded retry buffer so a transient remote outage does not silently
   drop writes.

### Explicit policy decision

A failing remote collector is **degraded-but-acceptable, and must be
surfaced**. It does not fail the worker and does not fail the awaited
collector-0 result — that stays the authoritative path, unchanged. But it must
never again be possible for a remote collector to fail continuously without a
human-visible signal. This is the requirement REQ-5 through REQ-9 encode.

## Requirements

**Token resolution (the narrow bug)**

- **REQ-1**: The worker resolves `.env` against the **primary repo root**
  (`resolvePrimaryRepoRoot(process.cwd())`, already imported at line 63),
  not against a bare relative path. When the resolver throws (not inside a git
  repo — tests, CI fixtures), fall back to `process.cwd()` exactly as
  `resolvePrimaryCwdDecision` degrades today. Never crash over this.
- **REQ-2**: The same treatment applies to `conductor/defaults.json` (line
  343) and `.laneconductor.json` (line 355), which have the identical latent
  cwd dependence.
- **REQ-3**: A `--manager` worker, which is deliberately never chdir'd, gets
  correct `.env` resolution via REQ-1 rather than via the cwd it happened to
  be launched with.
- **REQ-4**: When `.laneconductor.json`'s hot-reload watcher (line 2907)
  detects a change, `.env` is re-read as well, so adding a token to `.env`
  takes effect without a worker restart. Existing `process.env` values set by
  the real environment still win over `.env` file values, as they do today.

**Making failure loud**

- **REQ-5**: At startup, and again after every config reload, the worker logs
  one line per enabled collector naming the URL and where its token came from
  — e.g. `.env COLLECTOR_1_TOKEN`, `gcp-secret <name>`, `machine_token`,
  `config token`, or `NONE`.
- **REQ-6**: A collector with **no resolvable token** is reported as an
  `error`-level log naming the exact env key expected, at resolution time —
  before the first request is sent, not as a downstream 401.
- **REQ-7**: The worker maintains per-collector health in memory: total
  attempts, consecutive failures, last error status and message, last success
  timestamp.
- **REQ-8**: Per-write `console.warn` is replaced by threshold escalation. The
  first failure logs at `warn`. On reaching N consecutive failures (default 5,
  `LC_COLLECTOR_FAILURE_THRESHOLD`) the worker logs a single escalated
  `error` naming the collector, the consecutive count, and the last status.
  Further identical failures are throttled to at most one line per
  `LC_COLLECTOR_FAILURE_LOG_INTERVAL_MS` (default 60000) so the log cannot be
  flooded again. Recovery logs one `info` line.
- **REQ-9**: Per-collector health is included in the `/worker/register` and
  `/worker/heartbeat` payloads as `collector_health`, persisted server-side,
  and returned by the workers read endpoint.

**UI surface**

- **REQ-10**: `ui/src/components/WorkersList.jsx` shows a degraded-sync
  indicator on any worker with a collector in a failing state, with the
  collector URL, consecutive-failure count, and last error available on hover
  or in the detail view. A healthy worker shows no new chrome.

**Retry**

- **REQ-11**: Failed non-primary collector writes enter a bounded, in-memory
  retry buffer with exponential backoff (default cap 100 entries,
  `LC_COLLECTOR_RETRY_MAX`). Entries coalesce by `(collector, method, path)`
  so a track patched five times while the remote is down replays once, with
  the newest body. Eviction of the oldest entry when full is logged. This is
  deliberately **not** durable across restarts — see Non-Goals.

**Docs**

- **REQ-12**: `conductor/product.md` states plainly that the worker owns
  remote sync, that the local API server never writes to the cloud, and what
  collector-0 versus collector-1..n semantics actually are.

## Non-Goals

- Durable, on-disk persistence of the retry queue across worker restarts.
  Track state re-syncs from the filesystem on the next heartbeat, so the value
  does not justify a new write-ahead file. Revisit only if REQ-11's in-memory
  buffer proves insufficient in practice.
- Per-track `synced_to_remote` state and a per-track UI badge. Deferred as its
  own effort; REQ-9 and REQ-10 give worker-level visibility, which is what was
  actually missing during this incident.
- Fixing the 12 `404`s and 4 `400`s in the same log window. Those are the
  Firebase Hosting rewrite / missing-route gap already tracked as **10052**,
  and this track's collector points at the Cloud Function URL directly to
  bypass it.
- Version or capability handshake between worker and collector — that is the
  same category of silent-drift problem, tracked separately as **10061**.

## Acceptance Criteria

- [x] A worker started with cwd inside a linked worktree, with
      `LC_SKIP_CWD_NORMALIZATION=1` set so the chdir cannot mask it, sends the
      `Authorization` header on remote writes and receives no `401`.
- [x] A `--manager` worker started from an arbitrary cwd sends the
      `Authorization` header on remote writes.
- [x] Adding `COLLECTOR_1_TOKEN` to `.env` while a worker is running, then
      touching `.laneconductor.json`, causes the next remote write from that
      same process to carry the token — no restart needed.
- [x] Starting a worker with a collector configured and no resolvable token
      produces an `error` log naming the collector URL and the expected env
      key, before any request is sent.
- [x] Five consecutive remote failures produce exactly one escalated `error`
      line, not five; the sixth through hundredth within the throttle window
      produce none.
- [x] A recovered collector logs one `info` recovery line and resets its
      consecutive count to zero.
- [x] The workers API returns `collector_health` for a worker with a failing
      collector, showing the URL, consecutive-failure count, and last error.
- [x] Opening the Kanban UI with a worker whose remote collector is failing
      shows a degraded-sync indicator on that worker's row, with the collector
      URL and error reachable from it. Verified in a real browser against a
      running UI, not only in a unit test.
- [x] A write that fails while the remote is unreachable is replayed
      successfully after the remote returns, and five patches to the same
      track while it was down replay as one.
- [x] `conductor/product.md` states which component writes to the cloud.

## Data Model Changes

One new nullable column on `workers`, applied to both the local Postgres
schema and `cloud/functions`:

```sql
ALTER TABLE workers ADD COLUMN IF NOT EXISTS collector_health JSONB;
```

Shape, one entry per configured collector:

```json
{
  "https://api-pu7bcq73zq-uc.a.run.app": {
    "attempts": 1204,
    "consecutive_failures": 560,
    "last_error_status": 401,
    "last_error": "unauthorized: missing token",
    "last_success_at": "2026-09-03T11:31:02.000Z",
    "token_source": "none"
  }
}
```

Nullable, so every existing worker row and every worker running older code
stays valid with no backfill.
