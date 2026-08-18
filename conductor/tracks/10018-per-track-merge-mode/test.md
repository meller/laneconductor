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
- [ ] TC-6.3: **Not done — genuine gap.** No subprocess-level E2E through the real spawned worker process. See plan.md for why and what mitigates it.
- [ ] TC-6.4: N/A — no fixture generator found in this codebase to stamp (see TC-6.1)

## Acceptance Criteria
- [x] All unit + integration tests pass (70 new/updated tests across 6 files, all green; see per-phase notes above for exactly what each covers vs. code-review-only)
- [x] Existing merge/worktree E2E suites pass unchanged (direct-mode guarantee) — 11/11 worktree-merge, 13/13 worktree-audit, 5/6 local-api-e2e (pre-existing flake)
- [ ] Manual: one real PR opened + merged via panel on a throwaway track — **not done**, deliberately avoided touching real GitHub/the live fleet during implementation; recommend as a manual smoke test before shipping
- [x] No regressions in WorktreesPanel existing actions (abandon/remove/refresh) — confirmed via diff review; existing action code paths untouched by this track's edits
