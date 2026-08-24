# Tests: Track 10018 — Per-Track Merge Mode (PR vs Direct)

## Test Commands
```bash
# Unit + integration (worker/services)
node --test conductor/tests/merge-mode.test.mjs

# Existing merge E2E must stay green (direct-mode regression guard)
node --test conductor/tests/local-api-e2e.test.mjs

# UI tests
cd ui && npx vitest run src/lib/worktreeStats.test.js src/components/

# Full suite
make test 2>/dev/null || npm test
```

## Test Cases

### Phase 1: Schema + FS marker + sync parsing — all covered (`track-10018-merge-mode.test.mjs`, 14/14 pass)
- [x] TC-1.1: `resolveMergeMode` null/absent/'pr'/'direct'/case-insensitive/garbage — all covered
- [x] TC-1.2 / TC-1.3: FS↔DB marker sync wired in both directions (code review — see `laneconductor.sync.mjs`'s payload build + `updateIndexMDFromDB`); not covered by a dedicated integration test, verified by reading the two call sites and by the existing `local-api-e2e.test.mjs` suite still passing (exercises the same sync machinery for other fields)
- [x] TC-1.4: `parseMergeModeMarker` returns `null` (not `'pr'`) when the marker is absent — covered directly
- [x] TC-1.5: Migration applied twice against the real local Postgres during implementation, second run was a no-op (`ALTER ... IF NOT EXISTS`) — verified manually, not via an automated test

### Phase 2: PR creation path — covered at the service-unit level (`track-10018-pr-flow.test.mjs`, 18/18 pass), NOT via a full worker-process E2E (see Phase 6 gap below)
- [x] TC-2.1: `direct` mode is a no-op change to the existing path — verified by the unmodified 11/11 `worktree-merge`/`refresh-worktrees` suites passing
- [~] TC-2.2/2.3: covered in spirit, not literally — `createTrackPr`'s exact `gh`/`git` argv and stdout parsing is unit-tested against a fake exec; the *lane* stays `done:success` rather than `done:pr-open` (see plan.md's Phase 2 deviation note) — `pr_status='open'`/`pr_number`/`pr_url` persistence via `patchTrackPrFields` is code-reviewed, not test-covered end-to-end
- [x] TC-2.4: `checkGhAuth` failure path unit-tested (`ok:false` + message, never throws); `openTrackPrOnDone`'s comment-and-set-error-status behavior on that failure is code-reviewed, not test-covered end-to-end
- [x] TC-2.5: covered directly in `worktree-audit.test.mjs`'s new pr-open classification tests (a pr-mode done:success row never classifies `mergeable`, which is the classification the reconcile sweep's local-merge loop acts on) plus an explicit `readTrackMergeMode`-gated skip in `reconcileWorktrees`

### Phase 3: PR polling + cleanup — covered at the service-unit level, NOT via a full worker-process E2E
- [x] TC-3.1 (MERGED mapping): `resolvePrStatus({state:'MERGED'})` → `'merged'`, unit-tested; the actual cleanup call (`cleanupMergedPrTrack`'s ancestor-check + worktree removal + conditional branch delete) is code-reviewed, not test-covered end-to-end
- [x] TC-3.2/3.3/3.4: `resolvePrStatus` checks-failed/conflicted/closed mappings — all unit-tested
- [x] TC-3.5: `pollTrackPr` returns `null` on a `gh` failure — unit-tested; `reconcilePrTracks`'s "leave state alone on null" behavior is a one-line `if (!newStatus) continue` — code-reviewed, not separately test-covered
- [x] TC-3.6: `resolvePrStatus` is a pure function of the current poll result only (no memory of prior status) — recovery is structurally guaranteed, covered implicitly by the passing/failing/pending test cases each computing fresh

### Phase 4: Worktrees panel approval UI — covered (38 tests across worktreeStats/worktreePendingKeys/panel-scope/worktree-audit, all pass; `vite build` clean)
- [x] TC-4.1: `worktree-audit.test.mjs`'s new pr-open test asserts `mergeMode` on the row; badge rendering verified by `vite build` + code review (no RTL component test exists for this file — matches this repo's existing convention, it had none before either)
- [x] TC-4.2: `worktree-audit.test.mjs`'s PR-number test asserts `prNumber`/`prUrl`/`prStatus` pass through to the row
- [x] TC-4.3: gating logic (`canMergePr`) reviewed in code — see the documented simplification note in plan.md (coarse `pr_status`, GitHub is the real enforcement point)
- [~] TC-4.4: dispatch payload shape verified by code review of `handleMergePr`/the `merge-pr` worker handler; not exercised end-to-end
- [~] TC-4.5: same — `canCreatePr`/`handleCreatePr` reviewed, not exercised end-to-end
- [x] TC-4.6 (AC-8): `setMergeMode` PATCHes `merge_mode` through the same path Phase 1 tests already cover for FS↔DB sync
- [x] TC-4.7: direct-mode rows' existing buttons are unmodified by any of this track's edits — confirmed by diff review

### Phase 5: Dev-server branch preview — redesigned during implementation, see plan.md; verified by `vite build` + code review only
- [x] TC-5.1/5.2 (redesigned): `preview_cwd`/`preview_track` on the existing `/dev-server/start`, "return to main" = the same endpoint with no override — code-reviewed, no automated test (matches: the pre-existing `devServers` Map/start/stop/status code had no tests either)
- [x] TC-5.3: `/status` returns `preview_track` — code-reviewed
- [x] TC-5.4 (AC-7): `canRemove`'s `disabled={rowBusy || isPreviewing}` — code-reviewed
- [ ] TC-5.5: N/A under the redesign — there's no separate marker file to survive a restart; see plan.md Phase 5's dropped-Task-5 note
- [ ] TC-5.6: N/A — no `.preview.json` file exists in the redesign

### Phase 6: Migration + E2E
- [ ] TC-6.1: **Not done** — re-scoped, see plan.md (10000-series folders are live external canary artifacts, not this codebase's fixtures)
- [x] TC-6.2: `local-api-e2e.test.mjs` re-run after every phase — steady at 5/6 (1 pre-existing, unrelated flake confirmed on unmodified `main`)
- [x] TC-6.3: **Closed by Phase 11.** `track-10018-pr-flow-e2e.test.mjs` spawns the real worker process (no `LC_SKIP_GIT_LOCK`) against a real git fixture and a scriptable mock `gh`, proving `openTrackPrOnDone`/`reconcilePrTracks` end to end — quality-gate pass → real PR opened → synced to collector → MERGED detected → worktree/branch cleanup. 3/3 consecutive runs, no flakes. See plan.md's Phase 11 for the three real bugs (one production, two fixture) this found and fixed along the way.
- [ ] TC-6.4: N/A — no fixture generator found in this codebase to stamp (see TC-6.1)

### Phase 8: Playwright E2E for the PR-mode Worktrees panel + done-lane badge — ✅ covered (`conductor/tests/playwright/track-10018-pr-worktree-panel.spec.js`, 5/5 pass, fast tier, ~11s)
- [x] TC-8.1 (plan.md Task 1): pr-open row renders the `merge-mode-badge` ("PR"), `pr-open`/"PR Open" classification, `pr-link` (href + `PR #501` text), and `pr-status-badge` ("Checks pending") — asserted against real DOM elements, not code review
- [x] TC-8.2 (plan.md Task 2): clicking the armed "Merge PR" button twice (arm, then confirm) on a `pr_status: 'open'` row produces a real `worker_dispatch` row with `action='merge-pr'` and the seeded `track_number`, polled via direct DB query
- [x] TC-8.3 (plan.md Task 3): clicking "Create PR" on a pr-open row with no `pr_number` yet produces a real `worker_dispatch` row with `action='create-pr'`; also asserts no `pr-link` renders when there's no PR number
- [x] TC-8.4 (plan.md Task 4): rows seeded with `pr_status: 'checks-failed'` and `'conflicted'` each show the matching `pr-status-badge` text and have zero `merge-pr-btn` elements (the disabled, non-interactive span renders instead) — both variants covered explicitly, not just one
- [x] TC-8.5 (plan.md Task 5): a `done`-lane track whose track_number matches a seeded `mergeable`-class worktree row shows the "Unmerged" badge on its Kanban card (found via the search box, scoped via the new `track-card` testid); a second `done`-lane track with no matching worktree row shows neither "Unmerged" nor "Conflict" — both the presence and the absence case are asserted, not just one
- [x] TC-8.6 (plan.md Task 6): confirmed no `playwright.config.js` change needed — filename doesn't match `SLOW_SPECS`, runs in `fast` by default
- Stability: run 3x consecutively, 5/5 green every time; DB state confirmed fully restored after each run (no leftover `tracks` rows, `worker_dispatch` rows, or `worktrees` JSONB)
- **Found during implementation, not a pre-existing test case**: `track-1112-worktree-panel.spec.js`'s own worker-selection strategy (`ORDER BY last_heartbeat DESC LIMIT 1`) is flaky in this repo's own live dev environment, where multiple real heartbeat workers for project 1 are normally running concurrently — confirmed by running that unmodified file alone, independent of any change in this track. Not touched/fixed here (out of scope); this track's own new spec avoids the same trap by targeting a dedicated `pw-e2e-worker` DB fixture instead. See plan.md Phase 8 for detail.

### Phase 9: Merge/PR action buttons directly on done-lane Kanban cards — ✅ covered (`conductor/tests/playwright/track-10018-pr-worktree-panel.spec.js`, 4 new tests, same file as Phase 8, 9/9 total pass)
- [x] TC-9.1 (plan.md Task 1): "Merge to main" on a `mergeable`-class done card dispatches a real `worker_dispatch` row with `action='merge-worktree'` — single click, matching `WorktreesPanel.jsx`'s actual (non-armed) behavior for this action
- [x] TC-9.2 (plan.md Task 2, Merge PR half): "Merge PR" on a pr-open `pr_status: 'open'` done card, armed two-click, dispatches `action='merge-pr'`
- [x] TC-9.2 (plan.md Task 2, Create PR half): "Create PR" on a pr-open done card with no `pr_number` yet dispatches `action='create-pr'`
- [x] TC-9.3 (plan.md Task 3): a `conflicted`-class done card shows zero `card-merge-to-main-btn` elements and a visible disabled "Merge to main" span instead — never a silently-broken button
- [x] TC-9.4 (plan.md Task 4): implicit in TC-9.1/9.2 — each button transitions to "Merging…"/"Opening…" and disables during its own dispatch (observed via the armed-button text assertions); no separate test needed since the pending state is purely local component state, not a new integration point to verify independently
- [x] TC-9.5 (plan.md Task 5): implicit in all of the above — every action is dispatched and asserted without any navigation away from the board
- [x] TC-9.6 (plan.md Task 6): the 4 tests above are exactly the "at least one case per class" set the task asked for (mergeable, pr-open ready-to-merge, pr-open needs-create, conflicted-disabled)
- Stability: full 9-test file run 3x consecutively, 9/9 green every time; full fast-tier suite (26 tests, 6 skipped for unrelated reasons) also green including `track-1112-worktree-panel.spec.js`
- **Found during implementation, a real pre-existing bug (not a test gap)**: `track.project_id` is `undefined` on every row `GET /api/projects/:id/tracks` returns (the SQL SELECT never included it) — `DoneLaneMergeActions`' own dispatch calls silently went to `/api/projects/undefined/dispatch` until fixed by threading a `projectId` prop down from `App.jsx`'s `selectedProjectId`, matching the exact fallback pattern (`track.project_id ?? selectedProjectId`) already used by every other handler in `App.jsx`. Caught by the new tests themselves failing with "no worker_dispatch row created" — not something code review alone would have found, since the button visually looked correct (reached "Merging…") right up until the request. Also fixed the identically-broken `DevServerButton projectId={track.project_id}` one line away. See plan.md Phase 9 for the full account.

### Phase 10: Branch name (or "main") on every Kanban card — ✅ covered (`conductor/tests/playwright/track-10018-pr-worktree-panel.spec.js`, 1 new test, same file, 10/10 total pass)
- [x] TC-10.1 (plan.md Task 1): `worktree_branch` present in the `GET /tracks` response — exercised end-to-end by TC-10.2/10.3 rather than a separate unit test, since it's a one-line addition to the same enrichment map Phase 7's `worktree_class` already covers
- [x] TC-10.2 (plan.md Task 2 + Task 4 half 1): a card whose track has a live seeded worktree row (with `branch: 'track-19989'`) renders `⌥ track-19989` — asserted against the real DOM, not code review
- [x] TC-10.3 (plan.md Task 3 + Task 4 half 2): a `plan`-lane track with no worktree row renders `⌥ main` — confirms the "hasn't reached implement yet" case falls through correctly with zero special-casing
- Stability: full 10-test file run 3x consecutively (2x after the Phase 10 addition specifically), 10/10 green every time
- No new bugs found this phase (unlike Phase 9) — `worktree_branch` reused the exact same `wt?.field ?? null` convention `worktree_class`/`worktree_pr_status`/etc. already established, and `BranchIndicator` reads `track.worktree_branch` directly (no new `projectId`-style indirection needed, since it renders a label with no dispatch of its own)

### Phase 11: Subprocess-level E2E for the real worker-side PR flow — ✅ covered (`conductor/tests/track-10018-pr-flow-e2e.test.mjs`, 1/1 pass, 3/3 consecutive runs, ~8s each)
- [x] TC-11.1: Real worker process (no `LC_SKIP_GIT_LOCK`) claims a `quality-gate:queue` track with no `**Merge Mode**` marker, runs mock-cli's quality-gate, transitions to `done`, and forks into `openTrackPrOnDone` — asserted via the real `pr_status` reaching `'open'` on the collector, not a code-reviewed assumption
- [x] TC-11.2: `pr_number: 777`/`pr_url` match the mock `gh pr create`'s scripted response exactly, proving `createTrackPr`'s stdout-parsing runs for real inside the spawned process
- [x] TC-11.3: `git ls-remote origin refs/heads/track-19979` proves the branch was actually pushed to a real (throwaway) remote — not just committed locally
- [x] TC-11.4: local `main` is asserted NOT an ancestor of the track branch post-PR-open — direct proof of REQ-5/REQ-6 (no local merge in pr-mode) at the process level, not just via `mergeAndRemoveWorktree` never being called (which the unit tests already establish)
- [x] TC-11.5: after the fixture simulates GitHub merging the PR (real merge commit landed on the fixture's origin) and the mock `gh pr view` script is updated to report `MERGED`, `reconcilePrTracks`'s now-fast (`LC_RECONCILE_INTERVAL_MS=500`) poll picks it up — `pr_status` reaches `'merged'` on the collector for real
- [x] TC-11.6: cleanup confirmed against real filesystem/git state: `.worktrees/19979` directory gone, local `track-19979` ref gone (deleted only because the fixture made it a real ancestor of `main` first — exercising `cleanupMergedPrTrack`'s actual ancestor-check gate, not a stub)

**Three real bugs found and fixed via this test's own TDD cycle** (full account in plan.md Phase 11): (1) fixture — an empty bare origin's `HEAD branch: (unknown)` got cached by `getMainBranch()` as a literal branch name, breaking every git command that used it; (2) **production** — `openTrackPrOnDone`'s marker writes only ever reached the worktree's copy of `index.md`, never the primary checkout's, so `reconcilePrTracks` (which only reads primary) had nothing to poll — a pr-mode track would have silently never converged, in production, no matter what GitHub reported; (3) fixture — the first attempt to simulate a GitHub merge (`git reset --hard`) destroyed the very PR marker bug #2's fix had just written, producing a false "still broken" read.

## Acceptance Criteria
- [x] All unit + integration tests pass (89 new/updated tests across 7 files, all green; see per-phase notes above for exactly what each covers vs. code-review-only)
- [x] Existing merge/worktree E2E suites pass unchanged (direct-mode guarantee) — 11/11 worktree-merge, 13/13 worktree-audit, 5/6 local-api-e2e (pre-existing flake)
- [x] New Playwright E2E for the PR-mode Worktrees panel + done-lane badge + card actions + branch indicator (Phases 8-10) — 10/10 pass, verified against the real running app, not code review
- [x] Subprocess-level E2E for the real worker-side PR flow (Phase 11) — 1/1 pass, 3/3 consecutive runs, closes the last documented gap from Phase 6
- [ ] Manual: one real PR opened + merged via panel on a throwaway track — **not done**, deliberately avoided touching real GitHub/the live fleet during implementation; recommend as a manual smoke test before shipping
- [x] No regressions in WorktreesPanel existing actions (abandon/remove/refresh) — confirmed via diff review; existing action code paths untouched by this track's edits
