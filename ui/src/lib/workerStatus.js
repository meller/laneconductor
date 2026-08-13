// ui/src/lib/workerStatus.js
// Shared worker-liveness + default-selection logic. Previously
// isWorkerOffline was duplicated inline in both TrackDetailPanel.jsx and
// WorkerActivityLatch.jsx; selectDefaultWorker is new, extracted while
// fixing a live bug (2026-08-13): TrackDetailPanel's dispatch-target
// dropdown defaulted to an OFFLINE worker (the co-located manager) whenever
// the project's own worker was BUSY — busy is the common case for a
// healthy single-worker project, so this fired constantly, not as an edge
// case. Root cause: the fallback chain ended in `?? workers[0]` with no
// offline check, so once `idleWorker` (status !== 'busy' && online) found
// nothing, it silently fell through to whichever worker happened to be
// first in the array.

const WORKER_OFFLINE_MS = 60_000;

export function isWorkerOffline(worker) {
  if (!worker?.last_heartbeat) return true;
  return Date.now() - new Date(worker.last_heartbeat).getTime() > WORKER_OFFLINE_MS;
}

// Picks a sensible default worker to target for a manual dispatch:
// the assignee's own worker if it's online, else any online idle worker,
// else any online worker at all (even busy — still a truthful, actionable
// default), and only as an absolute last resort (nothing online) the first
// worker in the list, offline or not, so the UI has *something* to show.
//
// Track 1112 dogfood incident (2026-08-13), second finding: a project's
// dispatch dropdown defaulted to the co-located MANAGER even though the
// project's own worker was idle and online — GET /api/projects/:id/workers
// deliberately includes the manager (`OR w.type = 'manager'`) so it's
// visible for cross-project actions, but it is never the right default for
// a project-scoped lane action (run implement/review/etc. on THIS track) —
// that's what F13 (same session) was about: a manager sharing a project's
// identity/token causes real corruption. `type !== 'manager'` is checked
// FIRST, ahead of even online-ness, so the manager only ever gets picked
// when it's the only worker registered at all.
export function selectDefaultWorker(workers, assigneeUid) {
  if (!workers || workers.length === 0) return null;
  const nonManager = workers.filter(w => w.type !== 'manager');
  const pool = nonManager.length > 0 ? nonManager : workers;
  const ownWorker = assigneeUid
    ? pool.find(w => w.user_uid === assigneeUid && !isWorkerOffline(w))
    : null;
  const idleWorker = pool.find(w => w.status !== 'busy' && !isWorkerOffline(w));
  const anyOnlineWorker = pool.find(w => !isWorkerOffline(w));
  return ownWorker ?? idleWorker ?? anyOnlineWorker ?? pool[0];
}
