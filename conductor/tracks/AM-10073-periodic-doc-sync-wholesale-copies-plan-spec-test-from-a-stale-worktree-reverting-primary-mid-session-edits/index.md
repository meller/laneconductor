# Track AM-10073: Periodic doc-sync wholesale-copies plan/spec/test from a stale worktree, reverting primary mid-session edits

**Lane**: plan
**Lane Status**: success
**Progress**: 100%
**Phase**: Planning complete
**Type**: dev
**Workspace**: branch
**Merge Mode**: direct
**Auto Run**: yes
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Problem**: Confirmed live on track 10067: mergeIndexMarkers' careful marker-level merge only applies to index.md. plan.md/spec.md/test.md get a plain whichever-is-newer file copy with no merge logic at all, so a live worktree checked out before a primary-side edit silently reverts that edit on the next sync cycle.
**Summary**: Plan ready: replace the blind copyFileSync of plan/spec/test/quality-gate in copyWorktreeArtifactsToPrimary with a real three-way merge (git merge-file) against a per-track merge-base cache, so a…
