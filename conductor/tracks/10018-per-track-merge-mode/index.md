# Track 10018: Per-Track Merge Mode (PR vs Direct) with Worktrees Approval Workflow

**Lane**: implement
**Lane Status**: queue
**Progress**: 97%
**Phase**: Phase 10 queued — branch name (or "main") on every Kanban card (Phases 1-9 complete and tested)
**Type**: dev
**Merge Mode**: direct
**Summary**: Per-track merge_mode (pr|direct, default pr): completed tracks open a GitHub PR for human review instead of auto-merging. Worktrees panel is the approval station; done-lane Kanban cards show an unmerged/PR-status badge (Phase 7) with the same merge/PR actions inline (Phase 9). Phase 10 (branch name on every card) queued — direct human feedback, also connects to track 1115's future main-direct workspace mode.

## Problem
When a track reaches done, the sync worker auto-merges its branch straight into main — no human review gate, no CI gating, and no way to test the worktree's build before it lands. Separately: a `done`-lane card gave no signal when the underlying branch/PR hadn't actually merged yet.

## Solution
Per-track `**Merge Mode**` marker (FS) + `merge_mode` column (DB), unspecified → `pr`. PR-mode tracks push their branch and open a GitHub PR on quality-gate pass; a `pr_status` field (not a new lane state — see plan.md's Phase 2 deviation note) tracks approval progress until a human merges via the Worktrees panel (or GitHub UI) or GitHub reports it merged. The panel gains a dev-server Preview swap (reusing existing single-dev-server infra) for testing a branch before approval. `direct` keeps today's auto-merge. Kanban cards in the `done` lane now show an "Unmerged"/PR-status badge whenever the underlying branch hasn't actually merged, for both direct- and pr-mode tracks (Phase 7).

## Phases
- [x] Phase 1: Schema + FS marker + sync parsing
- [x] Phase 2: PR creation path on quality-gate pass (see plan.md for a documented design deviation from spec.md REQ-3)
- [x] Phase 3: Reconcile loop PR polling + cleanup
- [x] Phase 4: Worktrees panel approval UI
- [x] Phase 5: Dev-server branch preview (redesigned during implementation — see plan.md)
- [ ] Phase 6: Migration of existing tracks + E2E — SKILL.md docs done; mass-stamping other in-flight tracks deferred, see plan.md for why
- [x] Phase 7: Unmerged-branch status on done-lane Kanban cards (direct human feedback)
- [x] Phase 8: Playwright E2E for the PR-mode Worktrees panel + done-lane badge — 5/5 tests passing against the real running app, see plan.md for what was covered plus two things found and fixed along the way (a missing `track-card` testid, and a pre-existing flake in `track-1112-worktree-panel.spec.js`, unrelated to this track, left as-is)
- [x] Phase 9: Merge/PR action buttons directly on done-lane Kanban cards (direct human feedback on Phase 7 — status and the action for it should be in the same place) — done, 9/9 Playwright tests passing (4 new), see plan.md for a real pre-existing bug found and fixed along the way (`track.project_id` was never populated by `GET /tracks`, silently breaking every card-level dispatch until fixed)
- [ ] Phase 10: Branch name (or "main") on every Kanban card (direct human feedback — a branch only exists from `implement` onward, and not always even then, depending on track 1115's future workspace-mode config) — queued, see plan.md for the exact task list

## Human review needed before this merges
1. **Phase 2's lane-state deviation** — `pr_status` carries approval state instead of a new `done:pr-open` lane value. Confirm this is acceptable, or ask for the literal spec.md behavior.
2. **Rollout**: default flips to `pr` for every track without an explicit marker, including tracks already in flight in this repo. Decide which in-flight tracks (if any) should be stamped `direct` before this ships.
3. **Still no subprocess-level test** of the real `openTrackPrOnDone`/`reconcilePrTracks` worker-side flow (see plan.md Phase 6 Task 3) — Phase 8/9's Playwright specs close the UI-layer gap only (badges, dispatch buttons, card actions), by design; that worker-process gap is unchanged and remains open.
4. **Pre-existing test flake found, not fixed**: `conductor/tests/playwright/track-1112-worktree-panel.spec.js` (untouched by this track) is flaky whenever this repo's own live dev environment has multiple real heartbeat workers running for project 1 concurrently — its worker-selection query races a real worker's own heartbeat cycle. Out of this track's scope; flagged for a separate fix.
5. **Merge to main is queued behind Phase 10** — same pattern as before: merge happens once the branch-name card indicator lands, as one combined change covering all 10 phases.
