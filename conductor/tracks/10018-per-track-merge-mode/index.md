# Track 10018: Per-Track Merge Mode (PR vs Direct) with Worktrees Approval Workflow

**Lane**: review
**Lane Status**: queue
**Progress**: 90%
**Phase**: Phases 1-5 complete and tested; Phase 6 partially deferred — see plan.md
**Type**: dev
**Merge Mode**: direct
**Summary**: Per-track merge_mode (pr|direct, default pr): completed tracks open a GitHub PR for human review instead of auto-merging. Worktrees panel is the approval station (badges, PR link/status, Create/Merge PR, branch preview via dev-server swap). Two items deliberately deferred for human review — see plan.md Phase 6.

## Problem
When a track reaches done, the sync worker auto-merges its branch straight into main — no human review gate, no CI gating, and no way to test the worktree's build before it lands.

## Solution
Per-track `**Merge Mode**` marker (FS) + `merge_mode` column (DB), unspecified → `pr`. PR-mode tracks push their branch and open a GitHub PR on quality-gate pass; a `pr_status` field (not a new lane state — see plan.md's Phase 2 deviation note) tracks approval progress until a human merges via the Worktrees panel (or GitHub UI) or GitHub reports it merged. The panel gains a dev-server Preview swap (reusing existing single-dev-server infra) for testing a branch before approval. `direct` keeps today's auto-merge.

## Phases
- [x] Phase 1: Schema + FS marker + sync parsing
- [x] Phase 2: PR creation path on quality-gate pass (see plan.md for a documented design deviation from spec.md REQ-3)
- [x] Phase 3: Reconcile loop PR polling + cleanup
- [x] Phase 4: Worktrees panel approval UI
- [x] Phase 5: Dev-server branch preview (redesigned during implementation — see plan.md)
- [ ] Phase 6: Migration of existing tracks + E2E — SKILL.md docs done; mass-stamping other in-flight tracks and a full subprocess E2E test both deferred, see plan.md for why

## Human review needed before this merges
1. **Phase 2's lane-state deviation** — `pr_status` carries approval state instead of a new `done:pr-open` lane value. Confirm this is acceptable, or ask for the literal spec.md behavior.
2. **Rollout**: default flips to `pr` for every track without an explicit marker, including tracks already in flight in this repo. Decide which in-flight tracks (if any) should be stamped `direct` before this ships.
3. **Phase 6 Task 3 gap**: no subprocess-level E2E test exercises the real `openTrackPrOnDone` → `reconcilePrTracks` flow end-to-end (unit/integration coverage exists for each half separately — see plan.md).
