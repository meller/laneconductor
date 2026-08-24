# Tests: Track 1115 — Workspace Mode (main-direct vs branch-per-track)

Every case below maps to a REQ in `spec.md`. The E2E cases are the load-bearing
ones: this track changes branching logic inside `spawnCli()`, the single most
load-bearing function in the worker, and unit tests over a pure resolver cannot
detect a worktree that got created anyway.

## Test Commands

```bash
# Unit — pure resolver (fast, no processes)
node --test conductor/tests/track-1115-workspace-mode.test.mjs

# E2E — real spawned worker + mock collector + mock CLI, real git scratch repo
node --test conductor/tests/track-1115-workspace-mode-e2e.test.mjs

# Full worker suite — regression check (see baseline note under Acceptance)
node --test conductor/tests/*.test.mjs

# Syntax
find conductor ui bin -name "*.mjs" -not -path "*/node_modules/*" -exec node --check {} +

# Frontend unit (REQ-11 badge)
cd ui && npm test
```

## Test Cases

### Phase 2 — Resolver unit tests (REQ-1, D5)

Each case is one row of D5's table. The precedence cases (TC-3..TC-6) are the
ones that actually encode D1 — they must be written as explicit conflict
scenarios, not as single-input happy paths, or the ordering bug they exist to
catch will pass silently.

- [ ] TC-1: `laneStatus: 'plan'` + `workspaceMarker: 'branch'` → `'main'` —
      expected: D5 row 1 outranks an explicit branch marker (D6).
- [ ] TC-2: `laneStatus: 'plan'` + `trigger: 'auto-queue'` → `'main'` —
      expected: plan rule outranks the auto-queue override too.
- [ ] TC-3: `workspaceMarker: 'main'` + `trigger: 'auto-queue'` → `'main'` —
      expected: **the explicit marker wins over auto-queue** (D1's refinement;
      this is the case that diverges from plan.md's original sub-task wording).
- [ ] TC-4: `trackType: 'bug'`, no marker, `trigger: 'auto-queue'` → `'branch'`
      — expected: the *type-derived* default does NOT survive auto-queue (D5
      row 3 sits above row 4). Paired with TC-3, this pins the exact ordering.
- [ ] TC-5: `trackType: 'bug'`, no marker, `trigger: 'manual-dispatch'` →
      `'main'` — expected: D3's default applies when a human launched the run.
- [ ] TC-6: `trackType: 'bug'`, no marker, `trigger: 'auto-complete'` →
      `'branch'` — expected: auto-complete is treated as unattended (REQ-3).
- [ ] TC-7: `workspaceMarker: 'branch'`, `trackType: 'bug'` → `'branch'` —
      expected: explicit marker overrides the type default.
- [ ] TC-8: no marker, `trackType: 'feature'`, `projectWorkspaceMode: 'main'`
      → `'main'` — expected: D4 project default applies when nothing above hits.
- [ ] TC-9: no marker, no type, no project default → `'branch'` — expected:
      D5 row 6 fallback (today's behavior for every existing track).
- [ ] TC-10: `workspaceMarker: 'MAIN'` / `'garbage'` / `''` — expected: invalid
      values are ignored (treated as unset), not coerced to `'main'`.
- [ ] TC-11: `parseWorkspaceMarker()` on content with no `**Workspace**` line
      → `null`, not `'branch'` — expected: "unset" stays distinguishable from
      "explicitly branch" (D2).

### Phase 2 — Worker E2E (REQ-2, REQ-3, REQ-4, D7)

Harness: extend the `local-api-e2e.test.mjs` / `mock-collector.mjs` /
`mock-cli.mjs` pattern with a throwaway git repo per test. Assertions are on
**real git state**, never on log strings alone.

- [ ] TC-12: main-mode track through `implement` — expected: no
      `.worktrees/{NNN}` directory, no `track-{NNN}` branch
      (`git branch --list track-NNN` empty), and the mock CLI's commit present
      on the primary checkout's HEAD.
- [ ] TC-13: same run, lock behavior — expected: the lock file was created and
      released (REQ-2); main mode is not lock-free.
- [ ] TC-14: branch-mode `feature` track, lazy worktree (D7) — expected: after
      `plan` completes, no `track-{NNN}` branch and no worktree exist; after
      `implement` starts, both exist. Asserted as a *transition*, both halves in
      one test — checking only the post-implement state would pass even if the
      worktree had been created at plan time.
- [ ] TC-15: plan-on-main for a `feature` track (D6) — expected: `plan` leaves
      no branch behind, and the updated `spec.md`/`plan.md` are present on the
      primary checkout.
- [ ] TC-16: auto-queue with explicit `**Workspace**: main` — expected: runs on
      main (TC-3's rule, end-to-end through the real claim path).
- [ ] TC-17: auto-queue with `bug` type and no marker — expected: a real
      worktree and `track-{NNN}` branch are created.
- [ ] TC-18: main-mode commit convention (REQ-4) — expected: the spawned CLI's
      received prompt contains the track-reference commit instruction; the same
      run in branch mode does not. (`mock-cli.mjs` records its prompt.)
- [ ] TC-19: serialization (REQ-2) — two main-mode dispatches for two different
      tracks in the same project; expected: the second does not spawn until the
      first releases the lock, observed as start/stop ordering, not inferred
      from a single log line. Use `fake-slow-worker.mjs`/`fake-lock-holder.mjs`
      to make the window deterministic rather than racing on timing.

### Phase 2 — Dirty-checkout guard (REQ-10, D10)

- [x] TC-20 (**verified live via 7 real E2E tests, not just this unit
      case** — see spec.md D10's correction note): dirty file **outside**
      the track folder AND outside worker bookkeeping → main-mode
      dispatch does not spawn; expected: `lane_action_status` still
      `queue`, no CLI process started, `conversation.md` gained a comment
      naming the dirty path.
- [x] TC-21: same scenario, retry accounting — expected: retry count is
      **unchanged** (D10: a "not now" condition must not burn retries, or a
      human with unrelated files open permanently blocks the track). Verified
      structurally: the guard throws before `spawn()` is ever called, so the
      exit-handler code that increments `.retry-count` never runs.
- [x] TC-22 (**expanded during implementation**): dirty files **only
      inside** `conductor/tracks/{NNN}-*/` OR only the worker's own
      runtime bookkeeping (`conductor/.sync.pid`, `.sync.lock-target`,
      `.worker.tokens.json`, `conductor/tracks-metadata.json`) → the
      dispatch proceeds. This is the case that makes main mode usable at
      all in a real deployment — confirmed live: without the bookkeeping
      half of this exemption, every `plan`-lane spawn in every worker
      deployment was blocked (D6 makes plan always resolve to `'main'`),
      which broke 7 pre-existing E2E tests until fixed.
- [x] TC-23: branch-mode dispatch with a filthy checkout → unaffected, spawns
      normally. Expected: the guard is main-mode only.

### Phase 2 — Auto-complete merge (REQ-5, D8)

- [ ] TC-24: main-mode track reaching `done:success` via auto-complete —
      expected: reported **success**, `mergeWorktreeBranch()` not called, and the
      result text indicates no merge was needed. Regression guard against
      `{ merged: false, reason: 'no-branch' }` being surfaced as failure.
- [ ] TC-25: branch-mode track through the same path — expected: merge still
      happens exactly as today (guards against the D8 branch swallowing real
      merges).

### Phase 3 — Skill + CLI (REQ-7, REQ-8)

- [ ] TC-26: `lc new "T" "D" --workspace main` → generated `index.md` contains
      `**Workspace**: main`.
- [ ] TC-27: `lc new … --workspace bogus` → exits non-zero with a validation
      error; no track folder created.
- [ ] TC-28: `lc new` with no `--workspace` → no `**Workspace**` line emitted
      (stays unset so D5's defaults apply; must not hardcode `branch`).
- [ ] TC-29 *(manual, corrected — see spec.md REQ-8's note)*: run
      `/laneconductor plan` on a track with no `**Workspace**` and no
      `**Track Kind**` marker — expected: `**Track Kind**: bug|feature`
      written to `index.md` (NOT `**Workspace**`), and reasoning appended
      to `conversation.md` in the required `> **system**: …` format. Verify
      the comment actually reached `track_comments` (the format silently
      no-ops if malformed) rather than only checking the file on disk. A
      follow-up auto-queue claim on that track must still resolve to
      `branch` if `**Track Kind**` came out `bug` — this is the regression
      the correction exists to prevent.

### Phase 4 — UI + DB (REQ-6, REQ-11)

- [ ] TC-30 (corrected — see spec.md D3's implementation-time correction):
      `trackTemplates()` unit — `bug` emits `**Track Kind**: bug` and no
      `**Workspace**` line; `feature` emits neither. Also assert
      `resolveWorkspaceMode()` still defaults a `**Track Kind**: bug` track
      to `branch` when `trigger: 'auto-queue'` — the regression this
      correction exists to prevent.
- [ ] TC-31: marker → `tracks.workspace_mode` sync — editing the marker in
      `index.md` updates the column on the next sync tick.
- [ ] TC-32: migration applies cleanly to a DB with existing rows; expected:
      pre-existing tracks get `NULL` and continue to behave as `branch`.
- [ ] TC-33: `TrackCard` renders the mode badge next to the type badge; a track
      with `workspace_mode: null` renders no badge (not "branch").

### Phase 5 — Panel regression (REQ-9, D9)

- [ ] TC-34: main-mode track at `implement`, at `review`, and after
      `done:success` → produces **no** Worktrees panel row at any of the three.
      Driven end-to-end through `auditWorktrees()` against a real repo, not by
      unit-testing `belongsInWorktreesPanel` in isolation — D9's guarantee is
      that no row is *enumerated*, which a filter-level test cannot observe.
- [ ] TC-35: branch-mode track still appears in the panel as it does today.

## Acceptance Criteria

- [ ] All cases above pass.
- [ ] `node --test conductor/tests/*.test.mjs` shows **no new failures** versus
      a pre-track-1115 baseline captured on the same machine. The suite has
      known pre-existing failures (~23 top-level suites: real-Postgres E2E,
      auth/session — see `conductor/quality-gate.md`), so a raw pass/fail count
      is meaningless; diff against a stashed baseline, as track 1117 did.
- [ ] `find conductor ui bin -name "*.mjs" … -exec node --check {} +` — clean.
- [ ] `cd ui && npm test` — no new failures versus baseline.
- [ ] No regression for feature tracks: TC-14/TC-15/TC-25/TC-35 together
      demonstrate branch mode is behavior-preserving apart from D7's lazy
      worktree creation.
- [ ] The worker was **restarted** before any E2E verification — it does not
      hot-reload, and verifying against a process started before the change is
      a false pass (`quality-gate.md`, step 2a).
