// ui/src/lib/workerTaskInfo.js
// Track 1087 Phase 6 Task 3: parses worker.current_task (free text set by
// updateWorkerHeartbeat, laneconductor.sync.mjs) into what
// WorkerActivityLatch should show for that worker.

export function parseWorkerTask(currentTask) {
  if (!currentTask) return null;

  const deployMatch = currentTask.match(/^deploy \S+ \(dispatch (\d+)\)$/);
  if (deployMatch) return { kind: 'deploy', dispatchId: deployMatch[1] };

  const trackMatch = currentTask.match(/track (\S+)$/);
  if (trackMatch) return { kind: 'track', trackNumber: trackMatch[1] };

  return null;
}
