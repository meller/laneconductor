# Track AM-10073: Periodic doc-sync wholesale-copies plan/spec/test from a stale worktree, reverting primary mid-session edits

**Lane**: plan
**Lane Status**: running
**Progress**: 0%
**Phase**: New
**Type**: dev
**Workspace**: branch
**Merge Mode**: direct
**Auto Run**: yes
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Problem**: Confirmed live on track 10067: mergeIndexMarkers' careful marker-level merge only applies to index.md. plan.md/spec.md/test.md get a plain whichever-is-newer file copy with no merge logic at all, so a live worktree checked out before a primary-side edit silently reverts that edit on the next sync cycle.
**Summary**: Confirmed live on track 10067: mergeIndexMarkers' careful marker-level merge only applies to index.md. plan.md/spec.md/test.md get a plain whichever-is-newer file copy with no merge logic at all, so…
