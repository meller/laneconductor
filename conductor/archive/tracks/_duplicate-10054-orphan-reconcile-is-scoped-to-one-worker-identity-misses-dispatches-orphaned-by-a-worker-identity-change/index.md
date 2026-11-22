# Track TU-10054: Orphan-reconcile is scoped to one worker identity — misses dispatches orphaned by a worker-identity change

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Phase**: Fixed directly (self-hosted infra bug, main-mode) — see conversation.md
**Type**: dev
**Track Kind**: bug
**Author**: TU
**Created By**: test@example.com
**Summary**: reconcileOrphanedDispatches() queried /worker/${myWorkerId}/dispatch/claimed -- scoped to the CURRENT process's own worker_id in the DB. Confirmed live 2026-09-03: tracks 10016, 10050, and 10053…

## Fixed directly, 2026-09-03
New endpoint `GET /project/:id/dispatch/claimed-by-offline-workers` (`ui/server/index.mjs`) returns claimed dispatches whose owning worker's `last_heartbeat` is stale (>60s), independent of who's asking. `reconcileOrphanedDispatchesInner()` (`conductor/laneconductor.sync.mjs`) now merges these in alongside its own worker's claims before running the same classify-and-reconcile loop. New regression test in `conductor/tests/track-10020-orphan-reconcile-periodic.test.mjs` (seeds a claim under a second worker identity, confirms it's ignored while that identity looks alive, confirms it's swept once marked offline). 9/9 tests in that suite pass.

**Known gap left open**: `cloud/functions/index.js` does not have the new route — remote-api mode won't benefit from this fix until it's ported there too (same class of drift as track 1046/10052).
**Auto Run**: yes
