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
