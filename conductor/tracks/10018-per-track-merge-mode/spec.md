# Spec: Per-Track Merge Mode (PR vs Direct) with Worktrees Approval Workflow

## Problem Statement

When a track reaches `done:success`, the sync worker auto-merges its `track-N` branch straight into main via `mergeWorktreeBranch()` ([conductor/laneconductor.sync.mjs](../../laneconductor.sync.mjs), `mergeAndRemoveWorktree()` + the reconcile loop). There is:

- **No human review gate** — autonomous agent output lands on main unseen.
- **No CI gating** — GitHub Actions never runs before the merge; only local quality gates apply.
- **No way to test before merge** — the Worktrees panel shows unmerged branches but offers no way to run the app against a branch's worktree before approving it.

## Requirements

- REQ-1: A per-track merge mode with two values: `pr` and `direct`.
  - FS representation: `**Merge Mode**: pr|direct` bold marker in the track's `index.md`, parsed by the sync worker exactly like `**Lane**`.
  - DB representation: nullable `merge_mode text` column on `tracks`. `NULL`/absent resolves to `'pr'` via a single resolution function (`resolveMergeMode(track)`), so "explicitly pr" and "never specified" stay distinguishable.
  - Two-way sync follows the existing `last_updated_by` arbitration used for lane changes.
- REQ-2: **Default is `pr`** — any track without the marker/column pauses for approval. This deliberately flips current behavior for unspecified tracks.
- REQ-3: PR-mode flow — when a `pr`-mode track passes quality-gate:
  - Push `track-N` to the GitHub remote.
  - Open a PR via `gh pr create --base <mainBranch> --head track-N` with title/body derived from the track (number, title, summary).
  - Track parks in a new terminal-pending state `done:pr-open` (NOT `done:success`) — the worker must not locally merge it.
  - PR number + URL stored on the track row (`pr_number`, `pr_url`).
- REQ-4: PR polling — the existing reconcile loop additionally polls open-PR tracks via `gh pr view <n> --json state,mergeStateStatus,statusCheckRollup`:
  - `state: MERGED` (merged from panel, GitHub UI, or auto-merge-on-green) → run the existing local cleanup (remove worktree, delete/prune branch, transition track to `done:success`).
  - checks failing → surface `pr-checks-failed` status on the row (no lane change).
  - `state: CLOSED` unmerged → treat like today's stranded handling; surface `pr-closed`.
  - `mergeStateStatus: DIRTY` → surface as conflicted (same badge semantics as today's local `conflicted` classification).
- REQ-5: **No auto-merge in PR mode.** Green checks only enable the approval action; merging requires a human (panel button or GitHub UI). Approval from the panel runs `gh pr merge <n> --merge` so branch protection and required checks are enforced by GitHub, never bypassed locally.
- REQ-6: `direct`-mode tracks keep today's behavior byte-for-byte (auto-merge on done, reconcile auto-merge of mergeable/stranded rows).
- REQ-7: Worktrees panel (approval station) — each unmerged row shows:
  - a merge-mode badge (`PR` / `DIRECT`);
  - for `pr-open` rows: clickable PR link + live checks indicator (pending / passing / failing);
  - mode-appropriate actions: "Create PR" (pr-mode row without a PR yet, e.g. rescued stranded branch), "Merge PR" (enabled when checks green), existing Complete & Merge only for direct-mode rows;
  - "Remove worktree" disabled while that row is being previewed (REQ-8).
- REQ-8: Branch preview — a per-row "Preview" action that:
  - stops the project's current dev server, restarts it with cwd bound to that worktree's directory (single active preview at a time — no port allocation);
  - writes an active-preview marker (track number + worktree path) the UI reads;
  - shows a persistent banner ("Dev server is running track #N's worktree") + per-row "Previewing" badge + "Return to main" button that reverses the swap.
- REQ-9: Track detail panel gets a pr/direct toggle that writes through the same sync path as lane changes.
- REQ-10: Migration — E2E/canary tracks that exercise the auto-merge path (10000-series test tracks, 999) get an explicit `**Merge Mode**: direct` so test suites don't open real PRs against the GitHub repo. This track itself is `direct` for the same reason (it must be able to land while the PR flow is half-built).

## Acceptance Criteria

- [ ] AC-1: A track whose `index.md` has no `**Merge Mode**` marker, on quality-gate pass, ends up with an actual open PR on GitHub (visible via `gh pr list`) and its branch is NOT merged into local main.
- [ ] AC-2: A track marked `**Merge Mode**: direct` merges into main automatically on quality-gate pass, exactly as today (existing E2E merge tests still pass unchanged).
- [ ] AC-3: The Worktrees panel shows the `pr-open` row with a working PR link and a checks indicator that reflects real GitHub check status.
- [ ] AC-4: Clicking "Merge PR" on a green row merges the PR on GitHub; within one reconcile cycle the worktree is removed, the local branch cleaned up, and the track shows `done` on the board.
- [ ] AC-5: Merging the PR in the GitHub web UI (not the panel) produces the same cleanup + done transition within one reconcile cycle.
- [ ] AC-6: Clicking "Preview" on a row restarts the dev server against that worktree's directory; the app served at the dev URL reflects that branch's code; the banner shows which track is being previewed; "Return to main" restores the primary checkout's server.
- [ ] AC-7: While a row is previewed, its "Remove worktree" button is disabled.
- [ ] AC-8: Editing the pr/direct toggle in the track detail panel updates both the DB column and the `**Merge Mode**` marker in `index.md` (and vice versa when the file is edited).
- [ ] AC-9: A PR whose checks fail shows a failing indicator on the row and the track does not transition to done.

## Data Model Changes

```sql
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS merge_mode text;       -- 'pr' | 'direct' | NULL (→ resolves to 'pr')
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS pr_number integer;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS pr_url text;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS pr_status text;        -- 'open' | 'checks-failed' | 'conflicted' | 'closed' | 'merged' | NULL
```

New index.md markers: `**Merge Mode**: pr|direct` (synced ↔ `merge_mode`).

Active-preview marker file: `conductor/.preview.json` → `{ "track": "10018", "worktree_path": "...", "started_at": "ISO" }` (gitignored; absence = primary checkout active).

## Open Items / Risks

- The default flip (unspecified → pr) means ALL existing tracks change behavior; Phase 6's migration must land in the same release.
- `gh` CLI availability + auth is a precondition for PR mode; the worker must fail loudly (comment on the track + `pr_status` note) rather than silently fall back to direct-merge if `gh` is missing/unauthenticated.
- Preview swaps the shared dev server — acceptable by design (single-developer local stack), but the marker file must survive worker restarts so the banner never lies about which checkout is being served.
- **Open item (feeds track [1115](../1115-workspace-mode-main-vs-branch/index.md)):** should preview optionally also swap the *sync worker* to run from the branch's worktree, not just the dev server? That would let infra fixes to the worker itself be dogfooded from a branch — 1115's motivation #1 — shrinking its main-direct scope to live-pairing/attribution. Not required for this track's ACs; decide during Phase 5 and record the outcome here.
- Relation to track 1115 (workspace mode main vs branch): the two tracks form one three-way per-track strategy — `main-direct` | `branch + direct merge` | `branch + PR`. `merge_mode` applies only to branch-mode tracks; a future main-mode track (1115) has no branch and is excluded from the PR machinery entirely. Markers ship as siblings (`**Workspace**`, `**Merge Mode**`) resolved by one shared service. This track lands first.
