# Plan: Worker claim allowlist (Track 1109)

## Phase 1: `--only-tracks` in the CLI

**Problem**: No way to express a claim scope at the command line.
**Solution**: Parse and forward the flag alongside the existing
`--sync-and-work` / `--sync-only` / `--worker-number` flags in `bin/lc.mjs`.

- [x] Task 1: Accept `--only-tracks <csv>` on `lc worker start` and forward
      it verbatim to the spawned sync worker.
- [x] Task 2: Reject `--only-tracks` combined with `--sync-only` — a
      sync-only worker never polls the queue, so the pair is a silent no-op
      and should be an explicit error (design decision 4).
- [x] Task 3: Help text.

## Phase 2: Enforce the allowlist in the worker

**Problem**: `claimableSet` is null in local-fs mode and identity-derived
(so effectively "everything") in local API mode.
**Solution**: Parse the flag in `laneconductor.sync.mjs` and intersect it
with `claimableSet` at the existing gate — narrowing only, never widening.

- [x] Task 1: Parse `--only-tracks` into a `Set` of normalised track-number
      strings.
- [x] Task 2: Apply it at the gate (`laneconductor.sync.mjs:4113`),
      **independently of `claimableSet`** so it works in local-fs mode.
- [x] Task 3: Confirm it narrows only — a track excluded by `claimableSet`
      must stay excluded even when named in `--only-tracks`.
- [x] Task 4: Decide and document the `waitingForReply` interaction. The
      existing gate deliberately bypasses `claimableSet` for tracks
      mid-conversation; the allowlist must **not** be bypassed, or a scoped
      worker would answer arbitrary tracks and break the whole guarantee.

## Phase 3: `--once` lifecycle

**Problem**: A scoped worker still idles forever, so it is unusable as a
foreground tool or in CI.
**Solution**: Opt-in `--once` that exits when the scoped work is finished.

- [x] Task 1: `--once` flag, parsed in both CLI and worker.
- [x] Task 2: Exit only when nothing is running **and** no scoped track is
      still claimable. Never exit mid-track.
- [x] Task 3: Deregister cleanly on exit, reusing the existing SIGTERM path
      so no phantom worker is left in the UI.

## Phase 4: `lc worker run <track>` front door

- [x] Task 1: Implement as a thin wrapper over
      `start --sync-and-work --only-tracks <track> --once`, foreground.
- [x] Task 2: Stream output to the terminal and propagate the exit code.

## Phase 5: Observability

- [x] Task 1: Log the effective claim scope at startup.
- [ ] Task 2: **NOT DONE.** Report the scope to the collector so the UI can
      show a scoped worker as scoped rather than idle-and-broken. Only the
      startup log (Task 1) was implemented. Persisting this needs a new
      `workers` column plus UI work — a schema change, not a one-liner, so it
      is left open rather than half-shipped. Consequence today: in the UI a
      scoped worker is indistinguishable from an idle one.

## Phase 6: Tests

- [x] Task 1: Claims a listed track.
- [x] Task 2: **Leaves an unlisted queued track alone** — assert the
      negative.
- [x] Task 3: Allowlist narrows only, never widens `claimableSet`.
- [x] Task 4: `--once` exits when done, not mid-track.
- [ ] Task 5: **NOT VERIFIED.** Second scoped run of the same track should
      get `FRESH_SESSION: false`. Could not be tested with the local-fs
      fixture used for everything else: `resolveTrackSession` returns null in
      local-fs mode (`if (getIsLocalFs() || !myWorkerId) return null`), so
      session persistence is disabled there entirely and every run
      cold-starts by construction. Proving this needs an API-mode run with a
      real collector and a real agent invocation. Left open and explicitly
      NOT claimed — this is the exact assertion I insisted on adding to
      1084 Phase 7, so silently ticking it here would be indefensible.

## Phase 7: Docs

- [x] Task 1: `SKILL.md` + `lc worker --help`, leading with
      `lc worker run <track>` as the normal path.
- [x] Task 2: Note in `conductor/quality-gate.md` as the safe way to run the
      slow E2E tier — which is what unblocks track 1100.

## ⚠️ Implemented, NOT complete — 2026-08-13

Phases 1-4 and 7 are done and exercised for real. **Two tasks are
deliberately left open** (Phase 5 Task 2, Phase 6 Task 5) — see their
entries above. The feature works end to end; the gaps are UI reporting and
one unverified session-continuity assertion.

### The decisive evidence (Phase 2/6)

A unit test alone could not prove this works, so it was run against a real
local-fs fixture with **two** queued tracks (8801, 8802), both in
`implement:queue`:

| Run | Command | 8801 | 8802 |
|---|---|---|---|
| scoped | `--sync-and-work --only-tracks 8801` | **success** | **queue (untouched)** |
| control | `--sync-and-work` (unscoped) | success | **success (also claimed)** |

The control run is the part that matters: it proves the scoped result is
caused by the allowlist rather than by 8802 being unclaimable for some
unrelated reason. Without it, the first row proves nothing.

### `--once` (Phase 3)

- Scoped `--once` run exited **0 after 20s** (not the 60s timeout), leaving
  8802 at `queue`.
- `lc worker run 8802` — foreground, exited **0 after 21s**, ran only 8802.
- Typo guard: `--only-tracks 9999 --once` exits **1** with
  *"no queued or running track matched [9999]"* rather than exiting 0 and
  looking like success.

### Argument rejections (Phase 1) — all exit 2

`--only-tracks` + `--sync-only`; empty list; missing value; `--once` without
`--only-tracks`.

### Bug found and fixed during implementation

The Phase 7 help text I first wrote used backticks around `start` and
`--only-tracks` — inside a template literal, which terminated the string and
broke `bin/lc.mjs` at parse time. It took out 12 unrelated tests
(`lc brainstorm`, `--worker-number` pidfile, create-project dispatch) before
being caught. `node --check` **had** passed — but only because I ran it
before the help edit, not after. Re-check after every edit, not once per
session.

### Regression status

Controlled back-to-back comparison (clean `git worktree` at HEAD vs. working
tree): the only delta was `runDeploy`, which passes 3/3 in isolation, does
not reference anything this track touches, and did not reproduce in two
further full runs. It is the load-dependent flake already recorded during
track 1100's review.

⚠️ **The full-suite failure count is not a stable baseline right now** —
another session is committing test files concurrently (127 → 144 → 151 tests
during this work, including track 1110's deliberately-failing "pre-fix
baseline" reproductions). Counts observed: 6, 9, 7, 8 failures across runs of
the *same* code. Attribution was therefore done by back-to-back diff and
per-file isolation rather than by absolute counts.

`npx playwright test --project=fast` → **10 passed**, unchanged.

### Unblocks

Track 1100's slow tier can now be run without collateral:
`lc worker start --sync-and-work --only-tracks <track> --once`

## ✅ REVIEWED — 2026-08-13 (PASS, one residual gap)

6 of 7 spec acceptance criteria fully met. The 7th (`FRESH_SESSION: false` on
a second scoped run) was pushed further during review: the **mechanism** is
now proven against the live collector — a re-registered worker with a stable
`hostname` + `worker_number` reuses `worker_id 1123` and its `machine_token`
across three different pids, retrieves its `track_sessions` row, and a
`worker_number 8` worker correctly misses it. What remains unproven is the
literal marker reaching the agent prompt on a real run.

Still open: Phase 5 Task 2 (report claim scope to the collector for the UI).

Lane → quality-gate:queue per `workflow.json` `lanes.review.on_success`.
