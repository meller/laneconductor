// ui/src/lib/workerTaskInfo.test.js
// Track 1087 Phase 6 Task 3: parses worker.current_task (a free-text string
// set by updateWorkerHeartbeat) to decide what WorkerActivityLatch should
// show — a track's live transcript, or a deploy dispatch's raw log.

import { describe, it, expect } from 'vitest';
import { parseWorkerTask, resolveWorkerChatTarget } from './workerTaskInfo.js';

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

  // Track 1091 Phase 5: create-project also matches the generic
  // "(dispatch N)" pattern above — it must be distinguished from a real
  // deploy, since DeployLogView's endpoint is project-scoped and a
  // create-project dispatch has no project to scope it to.
  it('extracts a dispatch id from a create-project task string as its own kind, not deploy', () => {
    expect(parseWorkerTask('create-project (dispatch 12)')).toEqual({ kind: 'create-project', dispatchId: '12' });
  });

  it('returns null for an unrecognized task string rather than guessing', () => {
    expect(parseWorkerTask('something unexpected')).toBeNull();
  });
});

// Track 10037 REQ-5/REQ-7: target-track resolution matrix for worker chat.
describe('resolveWorkerChatTarget', () => {
  it('returns null for a manager, even a busy one with a track task', () => {
    const worker = { type: 'manager', current_task: 'implement track 42', last_track_number: '41' };
    expect(resolveWorkerChatTarget(worker, 1)).toBeNull();
  });

  it('prefers the running track over the last-context track', () => {
    const worker = {
      type: 'project', project_id: 5, current_task: 'implement track 42',
      last_track_number: '10', last_track_project_id: 5,
    };
    expect(resolveWorkerChatTarget(worker, 1)).toEqual({ trackNumber: '42', projectId: 5, source: 'running' });
  });

  it('falls back to last_track_number when idle', () => {
    const worker = {
      type: 'project', project_id: 5, current_task: null,
      last_track_number: '10', last_track_project_id: 5,
    };
    expect(resolveWorkerChatTarget(worker, 1)).toEqual({ trackNumber: '10', projectId: 5, source: 'last' });
  });

  it('returns null when the worker has neither a running nor a last track', () => {
    const worker = { type: 'project', project_id: 5, current_task: null, last_track_number: null };
    expect(resolveWorkerChatTarget(worker, 1)).toBeNull();
  });

  it('falls back to fallbackProjectId when the worker itself has none', () => {
    const worker = { type: 'project', project_id: null, current_task: null, last_track_number: '10', last_track_project_id: null };
    expect(resolveWorkerChatTarget(worker, 7)).toEqual({ trackNumber: '10', projectId: 7, source: 'last' });
  });

  it('returns null for a null/undefined worker', () => {
    expect(resolveWorkerChatTarget(null, 1)).toBeNull();
    expect(resolveWorkerChatTarget(undefined, 1)).toBeNull();
  });
});
