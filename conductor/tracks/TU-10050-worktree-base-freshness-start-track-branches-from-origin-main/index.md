# Track TU-10050: Worktree Base Freshness — Start Track Branches From origin/main

**Lane**: done
**Lane Status**: queue
**Progress**: 100%
**Phase**: Implementation complete — all 5 phases done
**Type**: dev
**Author**: TU
**Created By**: test@example.com
**Summary**: createWorktree (laneconductor.sync.mjs:3940) bases every new track branch on the literal `HEAD`, so branches start from a possibly-stale local main (checkOutOfBandGitSync only refreshes on a 5min cadence, and never at all once local main is ahead — this repo is permanently 27 ahead of origin/main) and from whatever branch the primary checkout happens to be on. Fix resolves the freshest base that loses nothing via a new pure resolver, never `origin/main` unconditionally (that would drop the 27 local commits).
**Merge Mode**: direct
