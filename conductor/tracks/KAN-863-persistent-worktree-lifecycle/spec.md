# Spec: Persistent Worktree Lifecycle

## Problem Statement
Currently, LaneConductor creates and destroys a git worktree for each individual lane run. This means:
- Uncommitted work is lost when retrying a phase or transitioning lanes
- Developers must re-do setup work between lane changes
- No continuity across the full track lifecycle (plan → implement → review → quality-gate → done)

## Requirements
- **REQ-1**: Add `worktree_lifecycle` configuration to `workflow.json` with two modes:
  - `'per-lane'`: Current behavior — create/destroy worktree per lane (strict isolation per run)
  - `'per-cycle'`: New default — persist worktree for full track lifecycle (plan → done)
- **REQ-2**: Default to `'per-cycle'` to preserve developer context by default
- **REQ-3**: On `done:success`, merge the feature branch to main and clean up the worktree
- **REQ-4**: Support both CLI-driven (`/laneconductor implement`) and daemon-driven patterns
- **REQ-5**: On retries within same lane, reuse existing worktree
- **REQ-6**: On lane transition, preserve uncommitted work in worktree
- **REQ-7**: If worktree is deleted externally, auto-recreate it on next lock attempt

## Acceptance Criteria
- [ ] `workflow.json` has top-level or per-lane `worktree_lifecycle` setting (default: `'per-cycle'`)
- [ ] Worktree persists across lane transitions when mode is `'per-cycle'`
- [ ] Worktree is destroyed on track completion (when reaching `done:success`)
- [ ] Retries within same lane reuse the worktree
- [ ] Both per-lane and per-cycle modes are tested and working
- [ ] Documentation updated in `product.md` and `tech-stack.md`

## Data Model Changes
Add to `workflow.json`:
```json
{
  "global": {
    "total_parallel_limit": 3,
    "worktree_lifecycle": "per-cycle"  // NEW: "per-lane" | "per-cycle", default "per-cycle"
  }
}
```

## Implementation Impact
- Modify `conductor/lock.mjs` — check config, reuse or create worktree based on mode
- Modify `conductor/unlock.mjs` — only destroy worktree if mode is `'per-lane'` or track is `done:success`
- Add cleanup logic to handle stale worktrees (e.g., if deleted externally)
- No database schema changes required (worktree path already tracked via lock file and index.md)

## Testing Strategy
- Unit: Mock lock/unlock behavior for both modes
- E2E: Spawn worker, run multi-lane track, verify worktree lifecycle
- Manual: Verify developer context is preserved during retries and transitions
