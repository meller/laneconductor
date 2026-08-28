// ui/src/lib/workerSort.js
// Track 10037 Phase 2 Task 1: pure ordering helper for the worker strip.
// Busy workers (or ones with a non-null current_task — a worker can be
// mid-dispatch without status having flipped to 'busy' yet) are shown
// first so they can't be scrolled out of view by idle workers; project
// workers before managers within each activity class; stable tiebreak by
// hostname then worker_number so re-renders don't reshuffle the strip.

function isActiveWorker(worker) {
  return worker.status === 'busy' || !!worker.current_task;
}

export function sortWorkersForStrip(workers) {
  if (!Array.isArray(workers)) return [];
  return [...workers].sort((a, b) => {
    const aActive = isActiveWorker(a);
    const bActive = isActiveWorker(b);
    if (aActive !== bActive) return aActive ? -1 : 1;

    const aManager = a.type === 'manager';
    const bManager = b.type === 'manager';
    if (aManager !== bManager) return aManager ? 1 : -1;

    const hostCompare = (a.hostname || '').localeCompare(b.hostname || '');
    if (hostCompare !== 0) return hostCompare;

    return (a.worker_number ?? 0) - (b.worker_number ?? 0);
  });
}
