# Track TU-10064: Remote collector sync fails silently

Six phases. Phases 1 and 2 are the narrow bug and are independently
shippable. Phases 3 through 5 are the surfacing work — the reason the bug
survived 560 failures. Phase 6 is docs.

---

## Phase 1: Resolve config and secrets against the primary repo root

**Problem**: `.env` (line 324), `conductor/defaults.json` (line 343) and
`.laneconductor.json` (line 355) are all read via bare relative paths. This is
currently masked by track 10019's chdir at line 171 — an undocumented,
untested ordering dependency that does not apply to `--manager` workers and is
disabled by `LC_SKIP_CWD_NORMALIZATION`.

**Solution**: Extract a small `resolveConfigRoot()` helper into
`conductor/services/config-root.mjs`, following the same
parameter-injection shape as `conductor/services/primary-cwd.mjs` so it is
testable without a real git repo. Use it for all three reads.

- [x] Task 1: Create `conductor/services/config-root.mjs` exporting
      `resolveConfigRoot({ cwd, resolvePrimaryRepoRoot })`, returning the
      primary repo root, or `cwd` when the resolver throws (REQ-1 fallback).
- [x] Task 2: Rewrite the `.env` load at `laneconductor.sync.mjs:324` into a
      `loadDotEnv(root)` function that joins against the resolved root, keeps
      the existing `!process.env[key]` precedence, and logs which path it
      loaded from.
- [x] Task 3: Apply the same resolved root to the `conductor/defaults.json`
      and `.laneconductor.json` reads (REQ-2).
- [x] Task 4: Confirm `resolvePrimaryRepoRoot` (imported line 63) is in scope
      at line 324. It is — the import is a top-level ESM binding — so no
      hoisting is needed; record that explicitly so the next reader does not
      re-derive it.
- [x] Task 5: Verify a `--manager` worker resolves `.env` correctly despite
      never being chdir'd (REQ-3).

**Impact**: Token and config resolution stop depending on cwd. The
10019 chdir becomes defense in depth rather than the only thing holding this
together.

---

## Phase 2: Re-read `.env` on config reload

**Problem**: `.laneconductor.json` is hot-reloaded at line 2907 and replaces
`config` at line 2919, so a newly added collector goes live mid-process.
`.env` is read once at startup and never again. This is the exact mechanism
that produced the incident: `collectors[1]` known, `COLLECTOR_1_TOKEN` never
loaded.

**Solution**: Call `loadDotEnv()` from the reload handler, before the new
config is applied.

- [x] Task 1: Invoke `loadDotEnv(configRoot)` at the top of the
      `.laneconductor.json` watcher handler (REQ-4).
- [x] Task 2: Make `loadDotEnv` idempotent and safe to call repeatedly —
      values already present in the real process environment still win, and a
      value already loaded from `.env` is updated when the file changes.
- [x] Task 3: Invalidate `tokenCache` (line ~1005) on reload so a
      newly-loaded token is actually used rather than served stale.
- [x] Task 4: Log one line when a reload changes the resolved token source
      for any collector.

**Impact**: Adding a token to `.env` takes effect on the next config touch
instead of requiring a restart nobody knew was required.

---

## Phase 3: Loud token resolution and per-collector health

**Problem**: `resolveToken()` returning `null` is indistinguishable from
success. `post()` silently omits the `Authorization` header
(`if (token)`), and the failure only appears as a downstream `401` in a
fire-and-forget `.catch`.

**Solution**: Report the token source at resolution time and track health
per collector.

- [x] Task 1: Extend `resolveToken()` to return the token **and** its source
      (`env` / `gcp-secret` / `machine_token` / `config` / `none`) without
      changing its callers' happy path.
- [x] Task 2: At startup and after each config reload, log one line per
      enabled collector: URL plus token source (REQ-5).
- [x] Task 3: A collector resolving to `none` logs at `error` level, naming
      the exact expected env key, before any request is sent (REQ-6).
- [x] Task 4: Add a `collectorHealth` map keyed by collector URL holding
      attempts, consecutive failures, last error status and message, last
      success timestamp, and token source (REQ-7).
- [x] Task 5: Record every outcome from `postToCollectors` and
      `patchCollectors` into that map, for collector 0 as well as 1..n.
- [x] Task 6: Replace the per-write `console.warn` with threshold escalation
      and throttling per REQ-8, using
      `LC_COLLECTOR_FAILURE_THRESHOLD` (default 5) and
      `LC_COLLECTOR_FAILURE_LOG_INTERVAL_MS` (default 60000). Log one `info`
      line on recovery.

**Impact**: A misconfigured collector fails at startup, visibly, with the
name of the thing to fix — instead of after 560 invisible writes.

---

## Phase 4: Report health through the heartbeat and persist it

**Problem**: Nothing about remote-sync health leaves the worker process, so
no API, DB row, or UI can ever show it.

**Solution**: Ship `collector_health` in the register and heartbeat payloads
and store it.

- [x] Task 1: Add `ALTER TABLE workers ADD COLUMN IF NOT EXISTS
      collector_health JSONB;` as a migration, applied to both the local
      Postgres schema and `cloud/functions`.
- [x] Task 2: Include `collector_health` in `upsertWorker()`
      (`laneconductor.sync.mjs:1107`) and `updateWorkerHeartbeat()`
      (line 1237) payloads (REQ-9).
- [x] Task 3: Accept and persist the field in `ui/server/index.mjs`'s
      `/worker/register` (line 3874) and `/worker/heartbeat` (line 3967).
      Ignore it when absent so an older worker still registers cleanly.
- [x] Task 4: Mirror the same handling in `cloud/functions/index.js`.
- [x] Task 5: Return `collector_health` from the workers read endpoint.

**Impact**: Remote-sync health becomes queryable state rather than log text.

---

## Phase 5: UI indicator and bounded retry

**Problem**: Even with health in the DB, nothing draws it; and a transient
remote outage still drops writes permanently.

**Solution**: Surface the indicator, and add a coalescing retry buffer.

- [x] Task 1: Add a degraded-sync indicator to
      `ui/src/components/WorkersList.jsx`, shown only when a collector is in a
      failing state, exposing collector URL, consecutive-failure count, and
      last error (REQ-10).
- [x] Task 2: Unit-test the indicator in `WorkersList.test.jsx` for both the
      healthy (no chrome) and degraded cases.
- [x] Task 3: Drive it in a real browser against a running UI with a seeded
      failing worker, and record the observation. A unit test alone cannot
      show the feature was wired up.
- [x] Task 4: Implement the bounded retry buffer per REQ-11 — cap
      `LC_COLLECTOR_RETRY_MAX` (default 100), exponential backoff, coalescing
      by `(collector, method, path)` keeping the newest body, logged eviction
      of the oldest entry when full.
- [x] Task 5: Drain the buffer on the next successful write to that
      collector; clear it on a token-source change.

**Impact**: A human sees a failing remote collector on the board, and a
recoverable outage stops losing data.

---

## Phase 6: Documentation

**Problem**: The naming is genuinely ambiguous. The local API server is
called a collector, the remote endpoint is called a collector, and the API
server holds a `CLOUD_FUNCTIONS_URL` it uses only for reads — so a reader
cannot tell from the code which component gets data to the cloud.

- [x] Task 1: State in `conductor/product.md` that the **worker** owns remote
      sync and that the local API server never writes to the cloud, citing
      `collectorWrite`'s self-pointing default and the read-only role of
      `CLOUD_FUNCTIONS_URL` (REQ-12).
- [x] Task 2: Document collector-0 (awaited, authoritative) versus
      collector-1..n (fire-and-forget, now health-tracked) semantics.
- [x] Task 3: Document the new env vars and the `.env`-reload behavior.
- [x] Task 4: Cross-reference 10052 (Hosting rewrites / missing routes) and
      10061 (version handshake) as the adjacent silent-failure tracks.

**Impact**: The next reader does not have to re-derive ownership from
`grep`.

---

## Notes for the implementer

- **The original problem statement's root cause is wrong, and the spec says
  so.** Do not "fix" the worktree `.env` path and consider the incident
  closed. The failing worker was in the primary checkout; the cause was the
  hot-reload versus read-once lifecycle mismatch. Phase 1 is still correct and
  worth doing, but Phase 2 is what actually explains the 560 failures.
- Evidence lives at `conductor/.sync.log` byte offsets `3093581384`
  (failing worker's startup and provenance line), `3110323131` (first `401`),
  `3126868365` (last `401`), `3126916886` (the restart that fixed it). The
  file is 3.3 GB — seek with `tail -c +N`, never `cat`.
- Reproducing the incident does not need a worktree. Start a worker with a
  `.laneconductor.json` holding one collector, then add a second collector to
  the config and its token to `.env` while it runs.
- The primary checkout currently holds three folders for this track number,
  including one prefixed `_duplicate-`. `lc track-dir 10064` resolves to the
  `TU-` one; that is the real folder. Cleaning up the other two is not this
  track's scope.

## ✅ COMPLETE

All 6 phases implemented and verified:
- 30/30 `node:test` cases pass across 6 new suites (unit + real-spawned-worker
  integration tests, all against dynamically-ported mock collectors — never
  the real local/remote endpoints; the one accidental exception during
  development was caught, repaired, and is documented in conversation.md).
- `WorkersList.test.jsx`: 11/11 pass (4 new). `cd ui && npm test`'s
  pre-existing 33 failures across 10 unrelated files are unchanged before
  and after this track's UI edit — confirmed by direct comparison.
- The UI badge was verified in a real running browser via an isolated
  scratch environment (throwaway DB + API + Vite), not only unit tests —
  screenshot at `evidence/sync-degraded-badge.png`.
- All 10 spec.md acceptance criteria checked off.
- `workers.collector_health` column applied directly to the local dev DB
  (additive, nullable) and captured in both the Atlas migration set and the
  local API's own migration runner.

The track's own reported root cause (a worktree-relative `.env` read) was
real but not what caused the 560-failure incident it cites — the actual
cause (a hot-reloaded config discovering a collector before its
never-revisited `.env` token) is documented in spec.md and conversation.md.
Both are fixed; the surfacing work (Phases 3-5) is what makes a future
recurrence of either impossible to miss silently again.
