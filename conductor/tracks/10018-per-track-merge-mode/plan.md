# Track 10018: Per-Track Merge Mode (PR vs Direct) with Worktrees Approval Workflow

## Phase 1: Schema + FS marker + sync parsing ✅ COMPLETE

**Problem**: There is nowhere to store a per-track merge mode — not in `index.md`, not in the `tracks` table.
**Solution**: Add the `**Merge Mode**` marker to the sync worker's index.md parser and a nullable `merge_mode` column (plus `pr_number`/`pr_url`/`pr_status`) to `tracks`, with a single `resolveMergeMode()` (NULL → `'pr'`).

- [x] Task 1: DB migration — `ui/server/migrations/009_merge_mode.sql`, applied and verified against the real local Postgres (idempotent, runs via the existing migrations-dir auto-runner)
- [x] Task 2: `**Merge Mode**` marker parsed both directions in `laneconductor.sync.mjs` (FS→DB payload build, DB→FS `updateIndexMDFromDB`)
- [x] Task 3: `conductor/services/merge-mode.mjs` — `resolveMergeMode()`/`parseMergeModeMarker()`, the only place NULL→'pr' lives
- [x] Task 4: `merge_mode`/`pr_number`/`pr_url`/`pr_status` exposed on `GET /api/projects/:id/tracks`, writable via `PATCH .../tracks/:num` and `/track/:num/action`

**Impact**: Merge mode is persisted, synced, and queryable. 14/14 unit tests (`track-10018-merge-mode.test.mjs`).

## Phase 2: PR creation path on quality-gate pass ✅ COMPLETE

**Problem**: Quality-gate pass unconditionally calls `mergeAndRemoveWorktree()` — every track merges locally.
**Solution**: Fork on `resolveMergeMode()`: `direct` keeps today's path; `pr` pushes the branch, opens a PR via `gh`.

- [x] Task 1: `createTrackPr()` in `conductor/services/pr-flow.mjs` — pushes `track-N`, runs `gh pr create`, parses `{number, url}` from stdout
- [x] Task 2: `checkGhAuth()` precondition — on failure, `openTrackPrOnDone()` posts a `⚠️` comment and sets `pr_status='error'`; never falls back to a local merge
- [x] Task 3: Wired into the exit-handler fast path (`readTrackMergeMode` + `openTrackPrOnDone`, right where `mergeAndRemoveWorktree` used to be unconditional)
- [x] Task 4: Reconcile loop's mergeable/stranded sweep skips pr-mode tracks (TC-2.5)

**⚠️ Design deviation from spec.md REQ-3**: the spec describes a `done:pr-open` lane state distinct from `done:success`. Implemented instead: the lane still transitions to `done`/`success` as it always has (unchanged `lane_action_status` semantics — introducing a new value there would ripple into every other consumer of that enum across the live fleet), and **`pr_status` alone carries the pending-approval signal** (`open`/`checks-failed`/`conflicted`/`closed`/`merged`/`error`). The Worktrees panel's `pr-open` *row classification* (a separate, UI-facing concept in `worktree-audit.mjs`, unrelated to the DB's `lane_action_status`) is what actually gates approval — a `pr`-mode track shows as `pr-open`, never `mergeable`, so the plain local-merge button can never fire. This was a deliberate risk-reduction call given this repo's own live multi-worker fleet depends on the existing `lane_action_status` enum; **flagged here for review**, not silently substituted.

**Impact**: PR-mode tracks stop at an open GitHub PR; direct-mode tracks are byte-for-byte unchanged (verified: 11/11 existing worktree-merge/refresh-worktrees tests pass unmodified).

## Phase 3: Reconcile loop PR polling + cleanup ✅ COMPLETE

- [x] Task 1: `reconcilePrTracks()` polls every track with an open `**PR Number**` marker via `pollTrackPr` (`gh pr view --json state,mergeStateStatus,statusCheckRollup`)
- [x] Task 2: `state=MERGED` → `cleanupMergedPrTrack()`: removes the worktree always; deletes the local branch only once it's a provable ancestor of local `mainBranch` (never races ahead of the separate git-divergence safe-pull mechanism, which is what actually brings the GitHub merge commit into the local primary — this function deliberately never runs a local `git merge`)
- [x] Task 3: `resolvePrStatus()` maps poll results → `pr_status` (`services/pr-flow.mjs`)
- [x] Task 4: Same 60s cadence as `reconcileWorktrees` (sibling `setInterval`, no new timer resolution); `pollTrackPr` returns `null` on any `gh` failure and the caller leaves state untouched (TC-3.5)

**Impact**: PRs merged anywhere (panel, GitHub UI, auto-merge-on-green configured on GitHub's side) converge to the same cleanup. 18/18 unit tests (`track-10018-pr-flow.test.mjs`, entirely against an injected fake `exec` — never a real `gh`/network call).

## Phase 4: Worktrees panel approval UI ✅ COMPLETE

- [x] Task 1: `worktree-audit.mjs` classifies a done pr-mode track as `pr-open` (never `mergeable`/`stranded`) and carries `mergeMode`/`prNumber`/`prUrl`/`prStatus` through; `WorktreeRow` renders the mode badge, PR link, and status indicator
- [x] Task 2: Mode-aware actions — "Create PR" (rescue, no PR number yet) / "Merge PR" (no known blocker — see note below) on pr-mode rows; `direct`-mode rows unchanged
- [x] Task 3: `create-pr`/`merge-pr` worker dispatch handlers, same pattern as `merge-worktree`
- [x] Task 4: pr/direct `<select>` in `TrackDetailPanel.jsx`, writes through `PATCH .../tracks/:num`

**Note on "Merge PR" gating**: `pr_status` is coarse by design (open/checks-failed/conflicted/closed/merged) and doesn't distinguish "checks pending" from "checks green" — both collapse to `open`. "Merge PR" is enabled whenever there's no *known* blocker; if checks are still pending, the click reaches `gh pr merge`, which GitHub itself rejects if branch protection requires green checks — never a silent bad merge, just a possible premature click that fails loudly. Acceptable simplification, not a gap in the actual safety property (REQ-5).

**Also fixed while implementing**: `belongsInWorktreesPanel` excluded worktree-less rows except `stranded` — a `pr-open` track whose worktree disappeared (worker restart, manual `git worktree remove`) would have silently vanished from the one panel meant to surface exactly that. Added as `pr-open`'s sibling exemption.

**Impact**: 18 unit tests (worktreeStats + worktreePendingKeys) + 7 (panel-scope) + 13 (worktree-audit, incl. 2 new pr-open cases) = 38 tests, all pass. `vite build` clean.

## Phase 5: Dev-server branch preview ✅ COMPLETE (redesigned during implementation)

**Design change from plan**: rather than new worker dispatch handlers (`preview-worktree`/`preview-stop`) and a `.preview.json` marker file, discovered and reused this repo's **existing** single-dev-server infrastructure (Track 1014's `devServers` Map + `/api/projects/:id/dev-server/{start,stop,status}` in `ui/server/index.mjs`) — it already does exactly "stop current, spawn fresh" in-process. Extended `/start` to accept optional `preview_cwd`/`preview_track`; `/status` now reports `preview_track`. No new endpoints, no marker file, no worker involvement at all — simpler and lower-risk than the original plan.

- [x] Task 1 (redesigned): `/dev-server/start` spawns `dev_command` with `cwd: preview_cwd || repo_path`, tags the in-memory `devServers` entry with `previewTrack`
- [x] Task 2 (redesigned): "Return to main" = calling `/start` again with no `preview_cwd` — falls through to `repo_path` naturally, same endpoint
- [x] Task 3 (redesigned): `/status` exposes `preview_track`; no separate marker file needed since the API server process is the same one holding the live PID either way
- [x] Task 4: WorktreesPanel — per-row "Preview" button (any row with a live worktree), persistent banner, "Remove worktree" disabled on the previewed row (AC-7)
- [ ] Task 5 (dropped, N/A under the redesign): "marker survives worker restart" doesn't apply — there's no separate marker file; an **API server** restart honestly clears preview state back to "nothing running," which is correct (nothing *is* running at that point either way), consistent with how `pid` already behaves across restarts today.

**Impact**: `vite build` clean. Manual code-level verification only (no automated test — the original devServers Map has none either; matches existing project convention for this specific subsystem).

## Phase 6: Migration of existing tracks + E2E — ⚠️ PARTIALLY COMPLETE, see deferrals

- [x] Task 5: SKILL.md updated — marker table row + a new "Per-Track Merge Mode" section covering behavior, approval flow, and a rollout note
- [x] Task 4 (folded into Phases 1-5 as each landed): `resolveMergeMode` unit tests, marker round-trip tests — done throughout, not held to the end
- [x] Task 2 (folded into Phase 2): existing merge/worktree E2E and unit suites re-run after every change — no regressions (11/11 worktree-merge, 13/13 worktree-audit including updated fixtures, 5/6 local-api-e2e — the 1 failure is a pre-existing, unrelated flake confirmed present on unmodified `main` too, `Cannot access 'cachedMainBranch' before initialization`)
- [ ] **Task 1: NOT done.** Re-scoped on inspection — the "10000-series E2E tracks" in this repo's `conductor/tracks/` are **live, externally-regenerated canary/synthetic-monitoring artifacts** (timestamp-suffixed folder names, continuously churned by the running fleet), not static fixtures this codebase generates. Mass-editing dozens of other in-flight tracks' `index.md` files was judged out of scope for a clean, reviewable track-10018 diff — those are other people's/the fleet's uncommitted work, not mine to touch. Separately confirmed the actual `node --test` E2E suites (`local-api-e2e.test.mjs`, `local-fs-e2e.test.mjs`) are unaffected regardless: they run with `LC_SKIP_GIT_LOCK=1`, which skips the entire worktree-lifecycle block (including the merge-mode fork) — they never reach `openTrackPrOnDone` at all.
- [ ] **Task 3: NOT done — genuine gap.** A true subprocess-level E2E test (spawn a real worker against a scratch repo + mock collector, drive a track to quality-gate pass, observe a mocked `gh` invoked for real through `openTrackPrOnDone`, then through `reconcilePrTracks`' actual 60s-interval poll to MERGED→cleanup) was not written. Reason: `reconcilePrTracks`'s interval is hardcoded (no test-only override, unlike `LC_SKIP_GIT_LOCK`), making a fast, non-flaky version of this test nontrivial within this session's scope. **Mitigated, not equivalent to, by**: 18 unit tests exercising `pr-flow.mjs`'s exact `gh` argv/parsing against an injected fake exec, and 13 tests exercising `worktree-audit.mjs`'s classification against *real* git repos (not mocked) — the two halves of the flow are each solidly covered; only their live wiring through a real spawned worker process is unverified by an automated test.

**Impact**: The default flip (unspecified → `pr`) is real and ships with this track. Rollout risk for existing in-flight tracks in **this** repo is real and explicitly called out in SKILL.md and here — a human decision, not something this track should make unilaterally by rewriting other people's tracks.

## Phase 7: Unmerged-branch status on done-lane Kanban cards ✅ COMPLETE

**Problem** (direct human feedback): a track at `lane_status='done'` only signals the lane *action* finished — it says nothing about whether the branch actually merged. Worktrees/PRs waiting for approval "aren't really done," but the board gave zero indication of that outside the separate Worktrees panel.

**Solution**: `GET /api/projects/:id/tracks` now cross-references the same live, git-derived worktree data the Worktrees panel already consumes (extracted `fetchWorktreeRows()`, shared by both endpoints) and attaches `worktree_class`/`worktree_pr_status`/`worktree_pr_url`/`worktree_pr_number` per track. `null` exactly when there's no live unmerged branch left for that track — `auditWorktrees()` omits fully-merged branches entirely, so absence here **is** the "really done" signal. `TrackCard.jsx` renders a badge next to the lane pill whenever `lane_status === 'done'` and `worktree_class` is non-null: "Unmerged"/"Conflict" for direct-mode tracks (a pre-existing gap this also happened to close), or the live PR status (open/checks-failed/conflicted/closed/merged/error) with a link to the PR for pr-mode tracks.

- [x] Task 1: `fetchWorktreeRows()` extracted from the `/worktrees` endpoint, reused by `/tracks`
- [x] Task 2: `/tracks` response enriched with `worktree_class`/`worktree_pr_status`/`worktree_pr_url`/`worktree_pr_number`
- [x] Task 3: `UnmergedBadge` component in `TrackCard.jsx`, rendered only on `done`-lane cards with a non-null `worktree_class`

**Impact**: `vite build` clean. No automated test (matches this file's existing convention — `TrackCard.jsx` has none today).

## Phase 8: Playwright E2E for the PR-mode Worktrees panel + done-lane badge ✅ COMPLETE

**Problem**: Phase 6 flagged a genuine gap — no automated test exercises the PR-mode UI (badges, Create PR/Merge PR dispatch, the new done-lane unmerged badge) against the real running app. This repo already has an established, documented pattern for exactly this: `conductor/tests/playwright/track-1112-worktree-panel.spec.js` seeds a real `workers.worktrees` JSONB row via direct DB write (the same shape the heartbeat reports), drives the real UI at `localhost:8090`/API at `localhost:8091`, and asserts on real `worker_dispatch` rows created by clicking real buttons — fast tier, deterministic, no LLM calls.

**Solution**: `conductor/tests/playwright/track-10018-pr-worktree-panel.spec.js`, following that exact pattern — seeds 4 `pr-open` rows (covering ready/needs-PR/checks-failed/conflicted) plus a `done`-lane track whose worktree row is still unmerged and one with no matching row, and asserts:

- [x] Task 1: Worktrees panel renders the PR badge, `pr-open` classification, PR link, and status indicator for a seeded pr-open row
- [x] Task 2: Clicking "Merge PR" on a seeded `pr_status: 'open'` row creates a real `worker_dispatch` row with `action='merge-pr'` and the right `track_number` payload
- [x] Task 3: Clicking "Create PR" on a seeded pr-open row with no `pr_number` creates a `worker_dispatch` row with `action='create-pr'`
- [x] Task 4: "Merge PR" is NOT clickable/enabled on a seeded row with `pr_status: 'checks-failed'` or `'conflicted'`
- [x] Task 5: A `done`-lane track (seeded via a direct `tracks` row insert, `lane_status='done'`) whose track_number also appears in the seeded `workers.worktrees` JSONB (as `class: 'mergeable'`) shows the "Unmerged" badge on its Kanban card; a `done`-lane track with NO matching worktree row shows no badge at all
- [x] Task 6: No `playwright.config.js` change needed — the filename doesn't match `SLOW_SPECS`, so it lands in `fast` by default, confirmed by the run (11s, no LLM/worker-claim dependency)

**Found and fixed during implementation, not part of the original task list**:
- **`TrackCard.jsx` had no stable per-card selector** — needed for Task 5's assertions to scope to one card among dozens on this project's own live board. Added `data-testid="track-card"` to the root element (matches this repo's existing `data-testid` convention used throughout `WorktreesPanel.jsx`).
- **Worker-selection race**: this repo's own live dev environment normally runs multiple real heartbeat workers for project 1 concurrently (dogfooding). `track-1112-worktree-panel.spec.js`'s pattern of picking `ORDER BY last_heartbeat DESC LIMIT 1` picks whichever real worker most recently beat — and that worker's own heartbeat cycle overwrites the seeded fixture within seconds, racing the test. Discovered a pre-existing fixture for exactly this (`workers` row with `hostname='pw-e2e-worker'`, `pid=999999`, nothing alive to overwrite it) and targeted it explicitly, falling back to "most recent" only if that fixture doesn't exist. **This is a pre-existing flake in `track-1112-worktree-panel.spec.js` itself** (confirmed: fails the same way run alone, on an unmodified copy of that file, whenever real live workers are heartbeating for project 1) — out of this track's scope to fix, noted here and in test.md.
- **Dev server was serving stale code during verification**: the shared local UI/API (ports 8090/8091) were running from the primary checkout (`main`), which obviously lacks this branch's changes. Restarted both from this worktree to actually exercise the code under test (`ui/` had no `node_modules` in the worktree — ran `npm install`), then restored the primary checkout's UI/API afterward. Separately hit and cleaned up an unrelated pre-existing orphaned `vite` process (running since the prior day, outlived its own `make ui-stop`) that was squatting port 8090 the whole time.

**Impact**: Closes Phase 6's documented E2E gap using this repo's own established, lower-cost pattern (DB-seeded fixture + real UI) rather than a full subprocess-spawned worker test — deterministic, fast (~11s), no `gh` mocking needed since the panel only ever dispatches, never calls `gh` directly itself. 5/5 new tests pass, run 3x consecutively with no flakes. Verified cleanup leaves zero DB residue (tracks rows, `worker_dispatch` rows, and the fixture worker's `worktrees` column all confirmed restored).

## Phase 9: Merge/PR action buttons directly on done-lane Kanban cards ✅ COMPLETE

**Problem** (direct human feedback on Phase 7): the `UnmergedBadge` tells you a done-lane card isn't really shipped yet, but it's read-only — acting on it (merge, approve the PR, retry a failed PR open) still requires leaving the card and finding the same track's row in the separate Worktrees panel. The status and the action for it should be in the same place.

**Solution**: Extended `TrackCard.jsx`'s done-lane badge area with a new `DoneLaneMergeActions` component reusing the exact same dispatch actions `WorktreesPanel.jsx` already has for a matching `worktree_class`/`worktree_pr_status` — `/api/projects/:id/dispatch` with `merge-worktree`/`create-pr`/`merge-pr`, no new backend work.

- [x] Task 1: `mergeable`/`stranded`-class done cards (`direct` mode) get a compact "Merge to main" button — dispatches `merge-worktree` with `{track_number}`
- [x] Task 2: `pr-open`-class done cards get "Create PR" (no `pr_number` yet) or "Merge PR" (no known blocker — `pr_status: 'open'`) — dispatches `create-pr`/`merge-pr` respectively, same gating as `WorktreesPanel.jsx`'s `canCreatePr`/`canMergePr`
- [x] Task 3: `conflicted`-class done cards show the action as a disabled, non-interactive span with the same "resolve manually" title text the panel uses; a `pr-open` card with a known blocker (checks-failed/closed/merged/error) similarly shows a disabled "Merge PR" span, mirroring the panel's own `isPrOpen && !canCreatePr && !canMergePr` case (not explicitly asked for by this task, but the same gating principle — never render nothing when there's a real blocked state to explain)
- [x] Task 4: card-scoped pending state (button shows "Merging…"/"Opening…" and disables) via local component state, keyed using the SAME `mergeKey`/`createPrKey`/`mergePrKey` functions imported from `worktreePendingKeys.js` (not shared React state with the panel — the two are separate component trees that may not even be mounted at the same time — but same identity-key naming, and both surfaces converge on the same server truth via their own poll, so they can't actually disagree)
- [x] Task 5: actions fire in place via `apiFetch` inside the card component itself, no navigation; the card's own badge updates on `usePolling`'s normal cadence once the dispatch resolves
- [x] Task 6: `track-10018-pr-worktree-panel.spec.js` extended with 4 new tests (mergeable, pr-open ready-to-merge-PR, pr-open needs-create-PR, conflicted-disabled) — see test.md

**Deviation from Task 1's "armed-confirm" wording**: implemented to match the PANEL'S ACTUAL current behavior instead — `WorktreeRow.jsx`'s own "Merge to main" and "Create PR" buttons are single-click, not armed; only "Merge PR" is armed two-click there. Task 1's text said "same armed-confirm pattern as the panel's own button" for the merge-worktree case specifically, which doesn't match the real code. Followed the actual panel behavior (verified by reading `WorktreesPanel.jsx` directly) rather than the plan text, since exact behavioral parity — not the literal wording — is what "the two surfaces never disagree about what's safe to click" requires. Card and panel now click identically: single-click Merge to main / Create PR, armed two-click Merge PR.

**Found and fixed during implementation, not part of the original task list — a real, pre-existing bug**: `GET /api/projects/:id/tracks` doesn't select `t.project_id` (the response is already single-project-scoped, so every consumer so far just assumed the surrounding page's own selected project). `DoneLaneMergeActions` makes its own direct `/api/projects/:id/dispatch` calls and needs a real id — using `track.project_id` directly meant every dispatch silently went to `/api/projects/undefined/dispatch`, which never created a `worker_dispatch` row (confirmed by a manual debug script: button reached "Merging…" and stayed there with zero rows created, while a manual curl POST to the correct URL worked instantly). App.jsx's own handlers already have this exact fallback everywhere (`track.project_id ?? selectedProjectId`) — threaded `projectId` as an explicit prop through `KanbanBoard.jsx` → `TrackCard.jsx` and `LaneFocusView.jsx` → `TrackCard.jsx`, and applied the same fallback inside `TrackCard` (`resolvedProjectId = track.project_id ?? projectId`). Also fixed the adjacent, identically-broken `DevServerButton projectId={track.project_id}` one line below while in there — same root cause, same one-line fix, would have been an inconsistency to leave broken right next to the fix. `startDrag`'s own `track.project_id` usage (multi-project drag identification) was left untouched — different code path, out of this phase's scope, no evidence it's actually relied on incorrectly.

**Non-goals held**: no new backend endpoints, no new dispatch actions, no change to `WorktreesPanel.jsx`'s own behavior — confirmed via diff review, only `TrackCard.jsx`/`KanbanBoard.jsx`/`LaneFocusView.jsx`/`App.jsx` (prop threading) and the test spec changed.

**Impact**: `vite build` clean, existing vitest suite unaffected (28/28 pass). New spec: 9/9 tests pass (5 from Phase 8 + 4 new), run 3x consecutively with no flakes. Full fast-tier Playwright suite: 20/20 pass (6 skipped, unrelated — no Firebase auth configured in this environment), including `track-1112-worktree-panel.spec.js` passing cleanly this run (its pre-existing live-multi-worker flake, documented in Phase 8, is non-deterministic and didn't reproduce here — not something this phase touched or needed to fix).

## Phase 10: Branch name (or "main") on every Kanban card ✅ COMPLETE

**Problem** (direct human feedback): cards only ever show lane/progress — nothing tells you whether a track is working on its own branch or still on `main`. Two reasons this matters beyond the `done`-lane badges Phases 7/9 already added: (1) a branch only exists from `implement` onward — a card in `plan`/`backlog` has no branch yet, and today gives no hint of that; (2) branching is not universal even once a track is running — track 1115 (workspace mode: `main`-direct vs `branch`-per-track, not yet implemented) will let some tracks work directly on `main` with no worktree/branch at all, by project or per-track configuration.

**Solution**: The data already existed — `fetchWorktreeRows()` (Phase 7) returns each live row's `branch` field, just wasn't surfaced. Attached it as `worktree_branch` alongside the existing `worktree_class` enrichment in `GET /api/projects/:id/tracks`, and a new `BranchIndicator` in `TrackCard.jsx` shows it on every card (all lanes, not just `done`): the real branch name (`⌥ track-10018`) when a matching worktree row exists, `⌥ main` otherwise.

- [x] Task 1: `worktree_branch` added to the same `worktreeByTrack` enrichment Phase 7 built in `GET /api/projects/:id/tracks` (`ui/server/index.mjs`) — one field, same map, same request, no new query
- [x] Task 2: `TrackCard.jsx`'s new `BranchIndicator` component renders `⌥ {branch}` in monospace, placed in the card header next to `TrackTypeBadge` — visible on every lane, not gated to `done` like `UnmergedBadge` is
- [x] Task 3: verified directly — a `plan`-lane seeded track with no worktree row renders `⌥ main`, confirming `worktree_branch` is correctly `null` for the "hasn't started yet" case with zero special-casing needed
- [x] Task 4: `track-10018-pr-worktree-panel.spec.js` extended with one more test: a seeded worktree row's real `branch` (`track-19989`) shows on its card, and a plan-lane track with no worktree row shows `⌥ main`

**No deviation from plan this phase** — implemented exactly as scoped, including the "no special-casing for 1115" claim: `worktree_branch` is `null` whenever a track has no live worktree row, for any reason (not yet past `plan`, worktree already cleaned up, or — once track 1115's main-direct mode ships — deliberately configured to skip branching entirely), and the frontend's fallback to "main" handles all three identically without knowing which case it is.

**Non-goals held**: no interaction — this is a label, not a link or action; confirmed via diff review, `BranchIndicator` has no `onClick`/dispatch of its own.

**Impact**: `vite build` clean, existing vitest suite unaffected (28/28). Extended spec: 10/10 pass (9 from Phases 8-9 + 1 new), run 3x consecutively with no flakes. Full fast-tier suite: 20/20 pass, 6 skipped (unrelated), `track-1112-worktree-panel.spec.js`'s already-documented pre-existing flake (Phase 8) reproduced once this run — consistent with its known non-determinism, not a regression from this phase (only `ui/server/index.mjs`, `TrackCard.jsx`, and the test spec changed; `local-api-e2e.test.mjs` still 5/6 with the same pre-existing, unrelated failure documented since Phase 8).

## Phase 11: Subprocess-level E2E for the real worker-side PR flow ✅ COMPLETE (closes the last documented gap)

**Problem** (direct human feedback): Phases 2/3's `openTrackPrOnDone`/`reconcilePrTracks` are implemented and unit-tested (`pr-flow.mjs`'s 18 tests, `worktree-audit.mjs`'s 13), but only as isolated pure functions against an injected fake `exec` — never as the real orchestration code actually running inside a spawned `laneconductor.sync.mjs` worker process, the way `local-api-e2e.test.mjs` already does for the ordinary implement/merge path. That's the one gap flagged since Phase 6 and repeated at every review point since.

**Why this wasn't just a copy-paste of the existing pattern**: `local-api-e2e.test.mjs`'s `startWorker()` always sets `LC_SKIP_GIT_LOCK: '1'`, which skips the entire worktree-lifecycle block — exactly the code path this needs to exercise. And `reconcilePrTracks`'s 60s `setInterval` had no test-only override, unlike `LC_SKIP_GIT_LOCK`.

**TDD sequence actually followed**:

- [x] Task 1: `LC_RECONCILE_INTERVAL_MS` (default `60000`) added as a shared override for BOTH `reconcileWorktrees`'s and `reconcilePrTracks`'s `setInterval` calls — kept symmetric, preserving Phase 3 Task 4's "same cadence" invariant
- [x] Task 2: `conductor/tests/mock-gh.mjs` — scriptable mock `gh`, JSON-file-driven (mutable mid-test via `MOCK_GH_SCRIPT_PATH`, unlike `mock-cli.mjs`'s single fixed env var, because a real PR's poll result changes mid-test: open → merged), plus an argv log for asserting exact `gh` invocations
- [x] Task 3: `conductor/tests/track-10018-pr-flow-e2e.test.mjs` written first, real bare-origin + clone fixture (`track-1112-git-divergence.test.mjs`'s pattern), deliberately WITHOUT `LC_SKIP_GIT_LOCK`
- [x] Task 4: Run and read the actual failures — **three real, in-order findings, each fixed with its own test-first cycle**, not the "probably just scaffolding" guess this task anticipated:
  1. **Fixture bug**: an empty bare `origin.git` reports `HEAD branch: (unknown)` — `getMainBranch()` cached that literal string as the main branch name for the worker's whole process lifetime, breaking every git command that used it (`git fetch origin (unknown)` — a real shell syntax error). Fixed in the fixture: `git symbolic-ref HEAD refs/heads/main` on the bare repo before cloning, matching what every real GitHub repo already has.
  2. **Real production bug, found live, not by code review**: `openTrackPrOnDone`'s marker writes (`**PR Number**`/`**PR URL**`/`**PR Status**`) only ever landed in the *worktree's* copy of `index.md`. `reconcilePrTracks()` only ever reads the *primary* checkout's copy — same as every other worker-side file read. Without a fix, a pr-mode track's PR would silently never converge, no matter what GitHub reports: confirmed live, the test hung forever waiting for `pr_status` to reach `'merged'`. Fixed in `laneconductor.sync.mjs`: `openTrackPrOnDone` now also writes the same three markers to the primary checkout's `index.md` directly.
  3. **Fixture bug**: simulating "GitHub merged the PR" by merging the track branch into `LOCAL`'s main hit a real conflict with the worker's own uncommitted marker writes on the same file. The first fix attempt (`git reset --hard`) silently destroyed the very `**PR Number**` marker Task 4.2 had just added — a false read that looked like the production bug recurring. Corrected: commit the dirty state first, then `git merge --no-ff -X ours` so the worker's freshly-written state wins over the branch's stale pre-run snapshot.
- [x] Task 5: Full flow passes against real state: branch pushed to the fixture's real `origin.git` (verified via `git ls-remote`), `pr_number`/`pr_url`/`pr_status='open'` synced to the collector, local `main` provably NOT an ancestor relationship with the track branch pre-merge, then post-MERGED: worktree removed, local branch deleted. **3/3 consecutive runs, no flakes.**
- [x] Task 6: Bug #2 above (the primary-vs-worktree marker gap) is the real orchestration bug this task anticipated — documented here per its own instruction.

**Impact**: The last standing gap from Phase 6 is closed with a real, passing, 3x-verified subprocess test — not a unit-level substitute. Regression check: 32/32 (`merge-mode`+`pr-flow` unit suites), 23/23 (`worktree-merge`+`worktree-audit`), `local-api-e2e.test.mjs` unchanged at 5/6 (same pre-existing, unrelated flake documented since the very first pass). `node --check` clean on every touched file.

**Non-goals held**: did not re-cover every `pr_status` branch (checks-failed/conflicted/closed) — `resolvePrStatus`'s unit tests already do that exhaustively; this test's job was proving the real wiring end to end at least once, which it now does.

## ⚠️ Gaps — Review (2026-08-19)

**Not a defect in this track's own implementation** — all 11 phases hold up under direct re-verification (unit tests, the Phase 11 subprocess E2E run 3x, `vite build`, frontend vitest, and direct code reading of every claimed fix all confirmed as described).

**Blocking**: this branch is 73 commits behind `main` (diverged 2026-08-18, main now at 2026-08-19), with 9 of those commits touching `ui/server/index.mjs` and 14 touching `conductor/laneconductor.sync.mjs` — the two files this track modified most heavily. No textual merge conflict today, but none of this track's extensive test suite has ever run against the current `main` (tracks 1102 F12/F17/F18/F21, 1115, 1116, 1117, 10019 all landed on `main` after this branch forked and are absent here). Per-cycle worktrees don't auto-resync with an advancing main mid-flight, so this needs to happen explicitly.

**Next implement pass**: merge/rebase current `main` into this branch, check the overlapping commits in `laneconductor.sync.mjs`/`index.mjs` for real semantic interaction (not just that git's auto-merge is clean), then re-run: this track's own test suites (`track-10018-merge-mode`, `track-10018-pr-flow`, `track-10018-pr-flow-e2e`, `track-1112-worktree-audit`, `track-1112-worktree-merge` + `track-10015-refresh-worktrees`, `track-1114-worktrees-panel-scope`), `local-api-e2e.test.mjs`, `cd ui && npx vite build`, and `cd ui && npx vitest run src/`. Return to review once green.

## ✅ QUALITY PASSED — Quality Gate (2026-08-20)

Full re-verification after merging `main` (73→75 commit gap): this track's own test suites all green (14+18+1×3+14+11+7+5=fixed by one self-heal), Playwright fast tier's 10 track-10018 tests 10/10 ×3, `vite build` clean, stub scan clean, real-product check performed. One self-healing fix landed (`4bb58af`): `local-api-e2e.test.mjs` needed `LC_SKIP_WORKER_LOCK` after main's new worker-identity singleton lock. Two broader findings confirmed pre-existing on unmodified `main` (not this track's issue): elevated failure count under the full `conductor/tests/*.test.mjs` glob (worker-identity-lock contention under concurrent execution — recommend a follow-up hardening track), and `WorkflowSettings.test.jsx` (track 1116's own file) failing under jsdom/`@xyflow/react`. See conversation.md for full detail.
