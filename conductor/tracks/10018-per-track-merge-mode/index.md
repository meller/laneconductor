# Track 10018: Per-Track Merge Mode (PR vs Direct) with Worktrees Approval Workflow

**Lane**: implement
**Lane Status**: queue
**Progress**: 92%
**Phase**: Phase 8 queued — Playwright E2E for the PR-mode panel + done-lane badge (Phases 1-7 complete and tested)
**Type**: dev
**Merge Mode**: direct
**Summary**: Per-track merge_mode (pr|direct, default pr): completed tracks open a GitHub PR for human review instead of auto-merging. Worktrees panel is the approval station; done-lane Kanban cards now show an…

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
- [ ] Phase 8: Playwright E2E for the PR-mode Worktrees panel + done-lane badge — queued, see plan.md for the exact task list (follows the existing `track-1112-worktree-panel.spec.js` DB-seed pattern)

## Human review needed before this merges
1. **Phase 2's lane-state deviation** — `pr_status` carries approval state instead of a new `done:pr-open` lane value. Confirm this is acceptable, or ask for the literal spec.md behavior.
2. **Rollout**: default flips to `pr` for every track without an explicit marker, including tracks already in flight in this repo. Decide which in-flight tracks (if any) should be stamped `direct` before this ships.
3. **Phase 8, once run**: the new Playwright spec closes the E2E gap for the UI layer via DB-seeded fixtures — still no subprocess-level test of the real `openTrackPrOnDone`/`reconcilePrTracks` worker-side flow (see plan.md Phase 6 Task 3).
