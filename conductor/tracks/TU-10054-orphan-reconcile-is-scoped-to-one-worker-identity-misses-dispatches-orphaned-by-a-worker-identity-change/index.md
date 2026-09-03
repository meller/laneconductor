# Track TU-10054: Orphan-reconcile is scoped to one worker identity — misses dispatches orphaned by a worker-identity change

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Author**: TU
**Created By**: test@example.com
**Summary**: reconcileOrphanedDispatches() queries /worker/${myWorkerId}/dispatch/claimed -- scoped to the CURRENT process's own worker_id in the DB. Confirmed live 2026-09-03: tracks 10016 and 10053 were…
