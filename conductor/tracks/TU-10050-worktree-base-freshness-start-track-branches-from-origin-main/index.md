# Track TU-10050: Worktree Base Freshness — Start Track Branches From origin/main

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Last Run**: claude/claude-sonnet-5 (primary)
**Phase**: Implementation complete — all 5 phases done
**Type**: dev
**Author**: TU
**Created By**: test@example.com
**Summary**: createWorktree (laneconductor.sync.mjs:3940) bases every new track branch on the literal `HEAD`, so branches start from a possibly-stale local main (checkOutOfBandGitSync only refreshes on a 5min…
**Merge Mode**: direct
