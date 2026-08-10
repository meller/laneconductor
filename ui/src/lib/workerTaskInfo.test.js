// ui/src/lib/workerTaskInfo.test.js
// Track 1087 Phase 6 Task 3: parses worker.current_task (a free-text string
// set by updateWorkerHeartbeat) to decide what WorkerActivityLatch should
// show — a track's live transcript, or a deploy dispatch's raw log.

import { describe, it, expect } from 'vitest';
import { parseWorkerTask } from './workerTaskInfo.js';

describe('parseWorkerTask', () => {
  it('returns null for an idle worker (no current_task)', () => {
    expect(parseWorkerTask(null)).toBeNull();
    expect(parseWorkerTask(undefined)).toBeNull();
    expect(parseWorkerTask('')).toBeNull();
  });

  it('extracts a track number from a lane-action task string', () => {
    expect(parseWorkerTask('dispatch-implement track 1087')).toEqual({ kind: 'track', trackNumber: '1087' });
    expect(parseWorkerTask('implement track 9998')).toEqual({ kind: 'track', trackNumber: '9998' });
  });

  it('extracts a dispatch id from a deploy task string', () => {
    expect(parseWorkerTask('deploy prod (dispatch 42)')).toEqual({ kind: 'deploy', dispatchId: '42' });
    expect(parseWorkerTask('deploy staging (dispatch 7)')).toEqual({ kind: 'deploy', dispatchId: '7' });
  });

  it('returns null for an unrecognized task string rather than guessing', () => {
    expect(parseWorkerTask('something unexpected')).toBeNull();
  });
});
