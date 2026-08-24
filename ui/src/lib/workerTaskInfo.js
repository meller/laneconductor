// ui/src/lib/workerTaskInfo.js
// Track 1087 Phase 6 Task 3: parses worker.current_task (free text set by
// updateWorkerHeartbeat, laneconductor.sync.mjs) into what
// WorkerActivityLatch should show for that worker.

export function parseWorkerTask(currentTask) {
  if (!currentTask) return null;

  // Track 1091 Phase 5: create-project's current_task also matches the
  // generic "(dispatch N)" pattern below, but it isn't a deploy — it has
  // no project to scope DeployLogView's endpoint to (that's the whole
  // point of the dispatch). Must be checked first.
  if (currentTask.startsWith('create-project ')) {
    const m = currentTask.match(/\(dispatch (\d+)\)/);
    if (m) return { kind: 'create-project', dispatchId: m[1] };
  }

  const dispatchMatch = currentTask.match(/\(dispatch (\d+)\)/);
  if (dispatchMatch) return { kind: 'deploy', dispatchId: dispatchMatch[1] };

  const trackMatch = currentTask.match(/track (\S+)$/);
  if (trackMatch) return { kind: 'track', trackNumber: trackMatch[1] };

  return null;
}
